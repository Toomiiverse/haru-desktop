"""Drive the open Blender from a shell, over the 3D Agent extension's TCP bridge.

    python blender/bridge.py handshake
    python blender/bridge.py get_scene_info
    python blender/bridge.py get_object_info '{"name": "Armature"}'
    echo 'print(len(bpy.data.objects))' | python blender/bridge.py exec
    python blender/bridge.py exec some_script.py
    python blender/bridge.py shot                 # PNG of the viewport, path last line

Any command in the extension's table works by name: handshake, get_blender_info,
get_installed_addons, get_scene_info, get_scene_graph, get_object_info,
get_mesh_stats, get_viewport_screenshot, get_scene_thumbnail, execute_code,
save_mainfile, save_as_mainfile, revert_mainfile, plugin_call.

Wire format is newline-delimited JSON on 127.0.0.1:9875, one frame per
round-trip. Exit status is 1 when the bridge answers with an error envelope.
"""

import json
import os
import socket
import sys
import tempfile

HOST, PORT = "127.0.0.1", 9875


def call(command, params=None, timeout=180):
    frame = json.dumps({"type": command, "params": params or {}}).encode() + b"\n"
    try:
        sock = socket.create_connection((HOST, PORT), timeout=timeout)
    except OSError as exc:
        raise SystemExit("no bridge on %s:%d (%s) - is Blender open?" % (HOST, PORT, exc))
    with sock:
        sock.sendall(frame)
        buffer = bytearray()
        while b"\n" not in buffer:
            chunk = sock.recv(8192)
            if not chunk:
                raise SystemExit("bridge closed before answering; check Blender's console")
            buffer.extend(chunk)
    return json.loads(bytes(buffer).split(b"\n", 1)[0].decode())


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    command, rest = argv[0], argv[1:]
    if command == "exec":
        code = open(rest[0], encoding="utf-8").read() if rest else sys.stdin.read()
        response = call("execute_code", {"code": code})
    elif command == "shot":
        path = os.path.abspath(
            rest[0] if rest else os.path.join(tempfile.gettempdir(), "blender_shot.png")
        )
        response = call("get_viewport_screenshot", {"filepath": path})
    else:
        response = call(command, json.loads(rest[0]) if rest else {})

    print(json.dumps(response, indent=2))
    if command == "shot" and response.get("status") == "success":
        print(response["result"]["path"])
    return 0 if response.get("status") == "success" else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
