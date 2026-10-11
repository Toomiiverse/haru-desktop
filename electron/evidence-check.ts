import { sourceTime, type ToolReceipt } from './tool-receipt';
import {recallRequest} from './request-kind';
import { claimsChecked } from './reply';

const MAX_LIVE_AGE_MS = 60_000;
const numeric = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
type Fact = { entity: string; aliases: string[]; metric: string; value: number | string; at: number | null; receipt: ToolReceipt };

function facts(receipts: ToolReceipt[]): Fact[] {
  const result: Fact[] = [];
  for (const receipt of receipts) {
    if (receipt.outcome !== 'succeeded' || receipt.access !== 'read') continue;
    const data: any = receipt.data;
    const gpus = receipt.tool === 'get_gpu_info' ? (Array.isArray(data) ? data : data?.gpus ?? data?.gpu ?? [data])
      : receipt.tool === 'get_system_info' ? data?.gpu : null;
    if (Array.isArray(gpus)) gpus.forEach((g: any, index: number) => {
      if (!g || typeof g !== 'object') return;
      const id = g.index ?? (numeric(g.gpu) ? g.gpu : index);
      for (const [metric, keys] of Object.entries({ temperature: ['temperature_c', 'temperature'], utilization: ['utilization_percent', 'load'], vram: ['vram_used_gb'] })) {
        const value = keys.map(k => g[k]).find(numeric);
        if (value !== undefined) result.push({ entity: `GPU ${id}`, aliases: [String(g.name ?? ''), String(g.name ?? '').match(/\b\d{4}\b/)?.[0] ?? ''], metric, value, at: sourceTime(g, receipt.observedAt), receipt });
      }
    });
    if (receipt.tool === 'get_service_status' && Array.isArray(data?.services)) {
      for (const s of data.services) if (s && typeof s.name === 'string' && typeof s.state === 'string') {
        result.push({ entity: s.name, aliases: [s.name.replace(/\.service$/, '')], metric: 'state', value: s.state, at: sourceTime(s, receipt.observedAt), receipt });
      }
    }
  }
  return result;
}
function historical(text: string): boolean {
  return /\b(?:recorded|earlier|previous|last reported|last reading|last observed|as of|back in|at the time|was|were)\b/i.test(text)
    && !/\b(?:now|currently|right now|still|latest|today)\b/i.test(text);
}
function usable(f: Fact, text: string, receipts: ToolReceipt[], now: number): boolean {
  if (historical(text)) return true;
  if (f.at === null || now - f.at > MAX_LIVE_AGE_MS || f.at > now) return false;
  if (receipts.some(r => r.tool === f.receipt.tool && r.outcome !== 'succeeded' && receipts.indexOf(r) > receipts.indexOf(f.receipt))) return false;
  // A later action can invalidate a machine observation even when the action outcome is unknown.
  return !receipts.some(r => r.access === 'mutation' && r.outcome !== 'failed'
    && /^(?:run_command|power|start_service|stop_service|restart_|open_app|close_app|browser_control)/.test(r.tool)
    && receipts.indexOf(r) > receipts.indexOf(f.receipt));
}

/** Deterministic checks for supported machine metrics, not a general truth oracle. */
export function evidenceProblem(reply: string, receipts: ToolReceipt[], now = Date.now(), request = ''): string | null {
  const all = facts(receipts);
  const suppliedSetup = /^\s*(?:the|my|our|a|an)\s+[^.!?\n]{2,100}\s+(?:is|are|has|have|needs?|uses?|wears?)\b[^.!?\n]*[.!]\s/i.test(request);
  const creativeRequest = /\b(?:suggest|recommend|imagine|creative|would suit|might suit|would look)\b/i.test(request);
  if (suppliedSetup && creativeRequest && /\b(?:you (?:have not|haven't) told me anything|I (?:have|know)(?: got)? nothing (?:on|about)|nothing (?:stored|on|about)\b)/i.test(reply)) {
    return 'The current user message already supplies the setup for a creative suggestion. Use those supplied facts and mark new details as suggestions. Do not claim the user supplied nothing or require an unrelated stored document. No new lookup is needed for that suggestion.';
  }
  // A requested observation must end in evidence or an explicit limitation,
  // not a promise to check later, a bare tool name, or invented prose/JSON.
  const instructionOnly = /\b(?:how (?:do|can|would|to)|show (?:me )?(?:an? )?example|(?:do not|don't) (?:check|read))\b/i.test(request);
  const liveGpuRequest = !instructionOnly && /\b(?:gpus?|graphics cards?)\b/i.test(request)
    && /\b(?:check|current|now|actual|reading|utilization|temperature)\b/i.test(request);
  const fileReadRequest = !instructionOnly && /\bread\b/i.test(request)
    && /\b(?:my|your) (?:note|file)|\b[\w -]+\.(?:md|txt|log)\b/i.test(request);
  const reminderRequest = /\b(?:set|create|save|schedule)\b.{0,40}\breminder\b|\bremind me\b/i.test(request)
    && !recallRequest(request)
    && !/\b(?:(?:do not|don't) (?:set|create|save|schedule|remind)|how (?:do|can|to)|example|suggest)\b/i.test(request);
  const limitation = /\b(?:can't|cannot|couldn't|unable to|don't have|do not have|no access|haven't|have not|could not|failed|unavailable|not available|not checked|not read|not saved|didn't save|did not save|nothing (?:was |has been )?(?:checked|read|saved)|no (?:live |current |actual |fresh )?(?:readings?|access|data))\b/i.test(reply);
  // A bounded, explicit file request must not end in a fabricated "Done".
  // This validates a result; it never infers or executes a write operation.
  const requestedWrite = /^\s*(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:create|write|save|update|append to|overwrite)\s+(?:(?:the |a )?(?:note|file)\s+)?["`]?((?:[\w.-]+\/)*[\w.-]+\.(?:md|txt|log))\b/i.exec(request);
  if (requestedWrite) {
    const latest = receipts.filter(r => r.tool === 'vault_write' && r.scope.path === requestedWrite[1]).at(-1);
    const withoutDenials = reply.replace(/\b(?:haven't|have not|didn't|did not|couldn't|could not|can't|cannot|not)\s+(?:been\s+)?(?:written|write|saved|save|created|create|updated|update|appended|append|overwritten|overwrite|done)\b/gi, '');
    const successClaim = /\b(?:done|saved|created|written|updated|appended|overwritten|now (?:says|contains))\b/i.test(withoutDenials);
    const clarification = !successClaim && (/\?\s*$/.test(reply) || latest?.outcome === 'pending' && /\b(?:confirm|confirmation|permission|approval|go-ahead)\b/i.test(reply));
    if (latest?.outcome !== 'succeeded' && !clarification && (successClaim || (!limitation && withoutDenials === reply))) {
      return 'The requested file has no successful write receipt for that path. Use the offered tool if authorized, or plainly say you have not written it. Printed content and "Done" are not execution.';
    }
  }
  if (reminderRequest && !receipts.some(r => ['create_kept_item', 'book_follow_up', 'set_reminder'].includes(r.tool))
    && /\b(?:I (?:tried|attempted)|I(?:'ve| have) (?:tried|attempted)|let me (?:do|save|set|create)\b.{0,30}\bnow)\b/i.test(reply)) return 'No reminder operation was attempted. Say it was not saved; do not claim an attempt or end with an unexecuted action promise.';
  if (!limitation && liveGpuRequest && !all.some(f => f.metric === 'utilization' || f.metric === 'temperature')) return 'The requested live GPU observation has no successful reading. Use an offered read tool or explicitly say you cannot check.';
  if (!limitation && fileReadRequest && !((true as boolean) ? require('./core-policy-sync').corePolicySync('system-evidence.fileRead', [receipts, request, now]) : receipts.some(r => r.outcome === 'succeeded' && ['vault_read', 'read_note', 'read_web_page'].includes(r.tool)))) return 'The requested file has not been read successfully. Read it with an offered tool or explicitly say you cannot access it.';
  if (!limitation && reminderRequest && !receipts.some(r => r.outcome === 'succeeded' && ['create_kept_item', 'book_follow_up', 'set_reminder'].includes(r.tool))) return 'The requested reminder has no successful creation receipt. Use the offered tool or explicitly say it was not saved. Printed JSON and promises are not execution.';
  let gpuContext = /\b(?:gpus?|graphics cards?|rtx|vram)\b/i.test(request);
  let contextId: string | undefined;
  let contextCard: string | undefined;
  if (claimsChecked(reply) && !historical(reply) && /\b(?:gpus?|graphics cards?|services?|obsidian|ollama)\b/i.test(reply)) {
    const machine = receipts.filter(r => r.outcome === 'succeeded' && /^(?:get_gpu_info|get_service_status|get_system_info|diagnose_system|run_command)$/.test(r.tool));
    if (!machine.some(r => r.observedAt !== null && now - r.observedAt <= MAX_LIVE_AGE_MS && r.observedAt <= now)) return 'A current machine check requires a fresh observation, not an old receipt.';
  }
  // Preserve decimal numbers while separating independent assertions.
  const assertions = reply.replace(/["“]([^"”\n]+)["”](?=\s+(?:was|is) wrong\b)/gi, 'that claim');
  for (const raw of assertions.replace(/```(?:json)?/g, '').split(/(?<!\d)[.!?;]\s*|(?<=\d)[.!?;](?!\d)\s*|\n|\bbut\b|\bhowever\b/)) {
    const clause = raw.replace(/\[[a-z]+\]/gi, '').trim();
    if (!clause) continue;
    if (/\b(?:gpus?|graphics cards?|rtx|vram)\b/i.test(clause)) gpuContext = true;
    // Hypotheses, attributed reports, and explicit uncertainty make no measured assertion.
    if (/^(?:if\b|suppose\b|imagine\b|you (?:said|reported)\b|according to you\b)/i.test(clause)
      || /\b(?:don't know|do not know|cannot (?:confirm|verify|determine)|can't (?:confirm|verify|determine)|haven't checked|have not checked|no evidence|no proof|no (?:current |fresh )?reading)\b/i.test(clause)) continue;
    const reminderClaim = /\b(?:reminder|appointment|calendar event)\b.{0,45}\b(?:set|saved|created|scheduled|booked)\b|\b(?:set|saved|created|scheduled|booked)\b.{0,45}\b(?:reminder|appointment|calendar event)\b|\bI(?:'ll| will) remind you\b/i.test(clause);
    if (reminderClaim && !/\b(?:not|no|never|failed|didn't|wasn't|isn't|couldn't|can't|cannot|haven't|hasn't|don't|whether|if)\b/i.test(clause)) {
      const latest = receipts.filter(r => ['create_kept_item', 'book_follow_up', 'set_reminder'].includes(r.tool)).at(-1);
      if (!latest || latest.outcome !== 'succeeded') return 'A reminder confirmation requires a successful matching creation result. Do not claim it was saved or promise delivery.';
    }
    const gpuId = [...clause.matchAll(/\bGPU\s*#?\s*(\d+)\b/gi)].at(-1);
    const card = [...clause.matchAll(/\bRTX\s*(\d{4})\b/gi)].at(-1);
    if (gpuId || card) { contextId = gpuId?.[1]; contextCard = card?.[1]; }
    if (gpuContext) {
      const quantities: [string, RegExp][] = [
        ['temperature', /(-?\d+(?:\.\d+)?)\s*(?:°\s*C\b|degrees(?:\s+C(?:elsius)?)?\b|Celsius\b)/gi],
        ['utilization', /(-?\d+(?:\.\d+)?)\s*%/g],
        ['vram', /(-?\d+(?:\.\d+)?)\s*G(?:i)?B\b/gi],
      ];
      for (const [metric, pattern] of quantities) {
        if (metric === 'vram' && !/\b(?:used|using|usage|allocated)\b/i.test(clause)) continue;
        for (const match of clause.matchAll(pattern)) {
          // A negative statement about a bad value is not an assertion of that value.
          if (/\b(?:not|isn't|wasn't)\s*$/i.test(clause.slice(0, match.index))) continue;
          const before = clause.slice(0, match.index);
          const id = [...before.matchAll(/\bGPU\s*#?\s*(\d+)\b/gi)].at(-1)?.[1] ?? contextId;
          const model = [...before.matchAll(/\bRTX\s*(\d{4})\b/gi)].at(-1)?.[1] ?? contextCard;
          const candidates = all.filter(f => f.metric === metric && (!id || f.entity.toLowerCase() === `gpu ${id}`)
            && (!model || f.aliases.some(a => a.includes(model))));
          const entities = new Set(candidates.map(f => f.entity));
          if (!id && !model && entities.size > 1) return 'Specify which GPU the measured value describes.';
          const latest = candidates.at(-1);
          if (latest && latest.value !== Number(match[1]) && candidates.slice(0, -1).some(f => f.value === Number(match[1])) && !historical(clause)) return 'A newer GPU reading supersedes that value.';
          // A live sensor moves between the read and the reply, so a small drift
          // is not a fabrication: temperature climbed a couple of degrees over a
          // slow turn and the turn was being failed for it. Utilization is an
          // integer percent; VRAM is already rounded to 0.1. Wide gaps (a wrong
          // GPU, an invented number) still fail.
          const tolerance = metric === 'temperature' ? 3 : metric === 'vram' ? 0.6 : 0;
          if (!latest || !numeric(latest.value) || Math.abs(latest.value - Number(match[1])) > tolerance) return `The ${metric} value does not match the recorded GPU and reading.`;
          if (!usable(latest, clause, receipts, now)) return 'The GPU reading is stale or was invalidated by a later action. Refresh it or explicitly describe it as historical.';
        }
      }
      const idleClaim = /\b(?:idle|idling|asleep|not busy|not doing anything)\b/i.test(clause)
        && !/\b(?:not idle|isn't idle|aren't idle|whether|if|might|maybe|could|would|should)\b/i.test(clause)
        && !clause.endsWith('?');
      const allGpus = /\b(?:all|every|each)\b/i.test(clause);
      if (idleClaim) {
        const relevant = all.filter(f => f.metric === 'utilization' && (allGpus || !contextId || f.entity.toLowerCase() === `gpu ${contextId}`)
          && (!contextCard || f.aliases.some(a => a.includes(contextCard!))));
        const latest = [...new Map(relevant.map(f => [f.entity, f])).values()];
        if (allGpus) {
          const count = /\ball (two|three|four|\d+)\b/i.exec(`${clause} ${request}`)?.[1]?.toLowerCase();
          const expected = count ? ({ two: 2, three: 3, four: 4 } as Record<string, number>)[count] ?? Number(count) : undefined;
          if (latest.some(f => !Array.isArray(f.receipt.data) && !Array.isArray((f.receipt.data as any)?.gpus) && !Array.isArray((f.receipt.data as any)?.gpu)) || expected !== undefined && latest.length !== expected) return 'A partial GPU observation cannot establish that all requested GPUs are idle.';
        }
        if (!latest.length || latest.some(f => f.value !== 0 || !usable(f, clause, receipts, now))) return 'An idle GPU claim requires a fresh zero-utilization reading for the claimed GPU(s).';
      }
      if (/\b(?:busy|under load|working hard)\b/i.test(clause) && !idleClaim
        && !/\b(?:not|isn't|aren't|if|whether|might|maybe|could|would|should)\b/i.test(clause)) {
        const relevant = all.filter(f => f.metric === 'utilization' && (!contextId || f.entity.toLowerCase() === `gpu ${contextId}`));
        if (!relevant.some(f => numeric(f.value) && f.value > 0 && usable(f, clause, receipts, now))) return 'A current GPU load claim requires a matching fresh observation.';
      }
    }
    const state = /\b(?:is|was|remains)\s+(?:currently |still )?(active|inactive|running|stopped|failed)\b/i.exec(clause);
    if (state && /\b(?:service|obsidian|haru|ollama)\b/i.test(clause)) {
      const candidates = all.filter(f => f.metric === 'state' && f.aliases.some(a => a && clause.toLowerCase().includes(a.toLowerCase())));
      const latest = candidates.at(-1);
      const expected = ({ running: 'active', stopped: 'inactive' } as Record<string, string>)[state[1].toLowerCase()] ?? state[1].toLowerCase();
      if (!latest || latest.value !== expected || !usable(latest, clause, receipts, now)) return 'The named service state needs a matching fresh status read; a start/stop acknowledgement is insufficient.';
    }
    if (/\b(?:backup|job|download)\b.{0,80}\b(?:completed|finished|succeeded)\b/i.test(clause)
      && !/\b(?:not|hasn't|haven't|didn't|isn't|unknown|unconfirmed|whether|if)\b/i.test(clause)) {
      const domain = /\b(backup|job|download)\b/i.exec(clause)![1].toLowerCase();
      if (!receipts.some(r => r.outcome === 'succeeded' && r.tool.includes(domain)
        && /"(?:status|state|outcome)":"(?:completed|succeeded|finished)"/.test(JSON.stringify(r.data)))) return 'Completion of that job has not been verified. Report its pending or unknown state.';
    }
  }
  return null;
}
