'use strict'

const HOST_CALL = 'globalThis.__isolated_host'
const CLOSE_HOST = 'closeIsolatedHost'

/* The template calls the returned closer. The snippet can replace the global
   or `call.close` and must not be able to keep the channel open. */
const source = methods => `
    const ${CLOSE_HOST} = (() => {
      const request = process.send.bind(process)
      const disconnect = process.disconnect.bind(process)
      const activeResources = process.getActiveResourcesInfo.bind(process)
      const onNextTurn = setImmediate.bind(globalThis)
      const countResources = () => {
        const counts = Object.create(null)
        for (const type of activeResources()) counts[type] = (counts[type] ?? 0) + 1
        return counts
      }
      const pending = new Map()
      let lastId = 0
      let closed = false
      let probes = 0
      let followUps = 0

      const settle = reason => {
        for (const waiting of pending.values()) waiting.reject(new Error(reason))
        pending.clear()
      }

      process.on('message', reply => {
        const waiting = pending.get(reply && reply.id)
        if (waiting === undefined) return
        pending.delete(reply.id)
        reply.failed ? waiting.reject(new Error(reply.reason)) : waiting.resolve(reply.value)
      })

      process.on('disconnect', () => {
        closed = true
        settle('the host channel closed before answering')
      })

      /* Handles open before the snippet runs (stdio, the channel) are not
         snippet work. The set depends on the platform, so compare counts
         rather than assuming a pipe. */
      const baseline = countResources()
      const snippetIsRunning = () => {
        const counts = countResources()
        /* Each in-flight check is itself an Immediate, and a follow-up is a
           Timeout. Those are not the snippet. */
        const immediates = Math.max(0, (counts.Immediate ?? 0) - probes)
        if (immediates > (baseline.Immediate ?? 0)) return true
        const timeouts = Math.max(0, (counts.Timeout ?? 0) - followUps)
        if (timeouts > (baseline.Timeout ?? 0)) return true
        for (const type in counts) {
          if (type === 'Immediate' || type === 'Timeout') continue
          if (counts[type] > (baseline[type] ?? 0)) return true
        }
        return false
      }
      /* While a call is released and awaited, look again shortly after other
         work may have finished. The timer is subtracted above so it is not
         itself that work. */
      const scheduleFollowUp = () => {
        if (followUps > 0 || closed) return
        let interested = false
        for (const waiting of pending.values()) {
          if (waiting.awaited && waiting.armed && !waiting.parkedSignal) interested = true
        }
        if (!interested) return
        followUps++
        setTimeout(() => {
          /* This timer is still listed here, so leave it in the count until
             the check has subtracted it. */
          if (closed) {
            followUps--
            return
          }
          const running = snippetIsRunning()
          followUps--
          for (const [id, waiting] of pending) {
            if (!waiting.awaited || !waiting.armed || waiting.parkedSignal) continue
            if (running) continue
            waiting.armed = false
            waiting.parkedSignal = true
            request({ id, parked: true })
          }
          if (running) scheduleFollowUp()
        }, 50)
      }

      const call = (method, args) => {
        let entry
        const answer = new Promise((resolve, reject) => {
          if (closed) return reject(new Error('the host channel is already closed'))
          const id = ++lastId
          entry = { resolve, reject, armed: false, awaited: false, parkedSignal: false }
          pending.set(id, entry)
          request({ id, method, args })
          /* After the send flushes. A microtask still sees that write, and on
             Linux it looks like the snippet kept running. */
          probes++
          onNextTurn(() => {
            /* This check's own Immediate is already off the list. What remains
               of the probe count is the sibling checks still scheduled. */
            probes--
            if (closed || !pending.has(id)) return
            if (snippetIsRunning()) {
              if (!entry.armed) {
                entry.armed = true
                request({ id, running: true })
              }
              if (entry.awaited) scheduleFollowUp()
              return
            }
            if (!entry.awaited || entry.parkedSignal) return
            entry.parkedSignal = true
            request({ id, parked: true })
          })
        })
        /* A call the snippet starts but never awaits must not take the run down
           with an unhandled rejection; awaiting it still surfaces the error. */
        answer.catch(() => {})
        const watch = () => {
          if (entry === undefined) return
          entry.awaited = true
          if (entry.armed) scheduleFollowUp()
        }
        const waited = {
          then (onFulfilled, onRejected) {
            watch()
            return answer.then(onFulfilled, onRejected)
          },
          catch (onRejected) {
            watch()
            return answer.catch(onRejected)
          },
          finally (onFinally) {
            watch()
            return answer.finally(onFinally)
          }
        }
        return waited
      }

      const close = () => {
        if (closed) return
        closed = true
        settle('the host channel closed')
        disconnect()
      }

      call.methods = ${JSON.stringify(methods)}
      call.close = close
      ${HOST_CALL} = call
      return close
    })()`

module.exports = { source, CLOSE_HOST }
