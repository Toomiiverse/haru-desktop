"""Process-shared admission and bounded recovery from abandoned drain leases."""
import fcntl
import json
import math
import os
from pathlib import Path
import time

MAX_LEASE_SECONDS=180

def gate_path():
    runtime=os.environ.get('XDG_RUNTIME_DIR','/run/user/'+str(os.getuid()))
    return Path(os.environ.get('HARU_AFFECT_DRAIN_FILE',str(Path(runtime)/'haru-voice-affect.maintenance.json')))

def activity_path(path=None):
    path=Path(path) if path is not None else gate_path()
    return path.with_suffix(path.suffix+'.active')

def owner_alive(path):
    """The controller holds this lock for its entire lease, including recovery."""
    with path.with_suffix(path.suffix+'.lock').open('a') as stream:
        try:fcntl.flock(stream,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:return True
    return False

def invalid_state(path,now,modified):
    expiry=modified+MAX_LEASE_SECONDS
    # Never reopen underneath a live controller, even if its lease is corrupt.
    expired=now>=expiry and not owner_alive(path)
    return {'draining':not expired,'expiresAt':expiry,
            'error':'expired_invalid_maintenance_lease' if expired else 'invalid_maintenance_lease'}

def gate_state(path=None,now=None):
    path=Path(path) if path is not None else gate_path();now=time.time() if now is None else now
    try:
        with path.open() as stream:
            modified=os.fstat(stream.fileno()).st_mtime
            raw=stream.read(4097)
        if len(raw)>4096:return invalid_state(path,now,modified)
        data=json.loads(raw)
    except FileNotFoundError:return {'draining':False,'expiresAt':None,'error':None}
    except ValueError:return invalid_state(path,now,modified)
    except OSError:return {'draining':True,'expiresAt':None,'error':'unreadable_maintenance_lease'}
    if not isinstance(data,dict):return invalid_state(path,now,modified)
    created,expires=data.get('createdAt'),data.get('expiresAt')
    if (type(created) not in [int,float] or type(expires) not in [int,float]
        or not math.isfinite(created) or not math.isfinite(expires)
        or not 0<expires-created<=MAX_LEASE_SECONDS or not isinstance(data.get('owner'),str)
        or created>now+MAX_LEASE_SECONDS):
        return invalid_state(path,now,modified)
    live_expired=now>=expires and owner_alive(path)
    return {'draining':now<expires or live_expired,'expiresAt':expires,
            'error':'lease_expired_controller_active' if live_expired else None}

class Admission:
    def __init__(self,stream):self.stream=stream
    def release(self):
        if self.stream is not None:self.stream.close();self.stream=None

def admit_analysis(path=None):
    """Shared lock remains held until actual inference completes, not disconnect."""
    if gate_state(path)['draining']:return None
    stream=activity_path(path).open('a')
    try:
        fcntl.flock(stream,fcntl.LOCK_SH|fcntl.LOCK_NB)
        if gate_state(path)['draining']:stream.close();return None
        return Admission(stream)
    except BlockingIOError:stream.close();return None
    except BaseException:stream.close();raise

def active_analysis(path=None):
    with activity_path(path).open('a') as stream:
        try:fcntl.flock(stream,fcntl.LOCK_EX|fcntl.LOCK_NB);return False
        except BlockingIOError:
            try:
                # Shared-lock success means analyses are active. Exclusive
                # controller ownership means all analyses already drained.
                fcntl.flock(stream,fcntl.LOCK_SH|fcntl.LOCK_NB);return True
            except BlockingIOError:return False
