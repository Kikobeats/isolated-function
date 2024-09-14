'use client'

import { Tabs, TabsContent } from '@/components/ui/tabs'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useState, useEffect, useRef, createElement, useCallback } from 'react'
import { highlight } from 'sugar-high'
import { compressToURI } from 'lz-ts'
import { Terminal, Code, Play, Pause, Clock, Database, RotateCcw } from 'lucide-react'
import { Editor } from 'codice'

const formatTime = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`)

function Timer () {
  const [time, setTime] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(prevTime => prevTime + 50)
    }, 50)

    return () => clearInterval(interval)
  }, [])

  return <span>{formatTime(time)}</span>
}

export function Snippet () {
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const [code, setCode] = useState(
    `// Node.js functions powered by Microlink
// Shift + enter to run!

const add = (x, y) => x + y

return add(1, 3)`.trim()
  )
  const [output, setOutput] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('code')
  const [isRunning, setIsRunning] = useState(false)
  const [isFirstTime, setIsFirstTime] = useState(true)
  const [duration, setDuration] = useState<string | null>(null)
  const [memory, setMemory] = useState<string | null>(null)
  const minimal = true

  useEffect(() => {
    if (editorRef.current) {
      const length = editorRef.current.value.length
      editorRef.current.focus()
      editorRef.current.setSelectionRange(length, length)
    }
  }, [])

  const runCode = useCallback(async () => {
    const codeWrapped = `(() => { ${code} })`
    const url = new URL('http://localhost:3000')
    url.searchParams.set('url', 'https://edge-ping.vercel.app/')
    url.searchParams.set('ping', 'false')
    url.searchParams.set('force', 'true')
    url.searchParams.set('prerender', 'false')
    url.searchParams.set('meta', 'false')
    url.searchParams.set('function', `lz#${compressToURI(codeWrapped)}`)

    console.log(url.toString())

    setIsRunning(true)
    setDuration(null)
    setMemory(null)
    setOutput(null)
    setActiveTab('output')

    const start = Date.now()

    fetch(url.toString())
      .then(response => {
        console.log(Object.fromEntries(response.headers))
        return response.json()
      })
      .then(payload => {
        const { data } = payload
        const { value, profiling } = data.function
        setIsFirstTime(false)
        setOutput(value)
        setMemory(`${Math.round(profiling.memory / (1024 * 1024))}MiB`)
        setDuration(`${formatTime(Math.round(Date.now() - start))}`)
        setIsRunning(false)
        setActiveTab('output')
      })
  }, [code])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.shiftKey && event.key === 'Enter') {
        runCode()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [code, runCode])

  return (
    <div className='w-full max-w-3xl mx-auto p-4'>
      <Tabs value={activeTab} onValueChange={setActiveTab} className='flex flex-col h-full'>
        <Card className='overflow-hidden flex flex-col'>
          <CardContent className='p-0 flex-grow overflow-hidden relative'>
            <div className='flex-grow overflow-hidden'>
              <TabsContent value='code' className='p-0 m-0 h-full'>
                <div className='relative h-full'>
                  <Editor
                    ref={editorRef}
                    value={code}
                    className='w-[640px] h-full'
                    highlight={text => highlight(text)}
                    onChange={text => setCode(String(text))}
                  />
                </div>
              </TabsContent>
              <TabsContent value='output' className='p-4 m-0 h-full overflow-auto w-[640px]'>
                {isRunning && (
                  <div className='text-gray-500 text-sm'>
                    <span className='loading dots mr-2'></span>
                    <Timer />
                  </div>
                )}
                {!isRunning && (
                  <pre className='border-gray-300 rounded overflow-auto h-[calc(100%-2rem)] text-sm'>
                    {output}
                  </pre>
                )}
              </TabsContent>
            </div>
            <div className='absolute bottom-4 right-4'>
              {!isFirstTime && !isRunning && (
                <Button
                  disabled={isRunning}
                  size='xs'
                  onClick={() => {
                    if (activeTab === 'code') setActiveTab('output')
                    else setActiveTab('code')
                  }}
                  className='bg-card hover:bg-neutral-100 border text-black mr-2'
                >
                  {createElement(activeTab === 'code' ? Terminal : Code, { className: 'w-3 h-3' })}
                </Button>
              )}
              <Button
                disabled={isRunning}
                size='xs'
                onClick={runCode}
                className='bg-green-500 hover:bg-green-600 text-white'
              >
                {isRunning
                  ? createElement(Pause, { className: 'w-3 h-3' })
                  : isFirstTime
                  ? createElement(Play, { className: 'w-3 h-3' })
                  : createElement(RotateCcw, { className: 'w-3 h-3' })}
              </Button>
            </div>
          </CardContent>
        </Card>
        {minimal && output && memory && duration && (
          <div className='flex pt-2 ml-auto space-x-4 mr-5'>
            <div className='flex space-x-4 text-[12px] text-gray-600'>
              <div className='flex items-center'>
                <Database className='w-4 h-4 mr-1' />
                Memory: {memory}
              </div>
              <div className='flex items-center'>
                <Clock className='w-4 h-4 mr-1' />
                Duration: {duration}
              </div>
            </div>
          </div>
        )}
      </Tabs>
    </div>
  )
}
