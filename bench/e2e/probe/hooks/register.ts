import type { Register } from 'claude-code'
const lines: string[] = []
async function log($: any, s: string) { lines.push(s); try { await $.fs.write('probe.log', lines.join('\n') + '\n') } catch (err) { } }
export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => { await log($, `PROMPT "${e.text.slice(0, 50)}" origin=${e.origin.kind} turnId=${e.turnId}`); return next(e) })
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    await log($, `  step ${e.index} asked=${e.model} effort=${e.effort} agent=${e.agentId ?? '-'} | served=${r.usage?.model} cache_read=${r.usage?.cache_read_input_tokens} cache_write=${r.usage?.cache_creation_input_tokens} in=${r.usage?.input_tokens} out=${r.usage?.output_tokens}`)
    return r
  })
  on('session.compact', async ($, e, next) => {
    const r: any = await next(e)
    await log($, `  COMPACT trigger=${e.trigger} skip=${r.skip} before=${r.tokensBefore} after=${r.tokensAfter} usage=${JSON.stringify(r.usage)}`)
    return r
  })
}
