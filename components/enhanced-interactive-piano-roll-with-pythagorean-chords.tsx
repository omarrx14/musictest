'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import * as Tone from 'tone'
import { Midi } from '@tonejs/midi'
import { Button } from '@/components/ui/button'
import { Play, Square, Plus, Trash2, Upload, Music, ChevronUp } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/use-toast'
import { Vex, Stave, StaveNote, Formatter, Renderer, Beam } from 'vexflow'

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const OCTAVES = 7 // From C2 to C8
const MEASURES = 4
const BEATS_PER_MEASURE = 4
const CELL_SIZE = 25
const NOTE_WIDTH = CELL_SIZE
const NOTE_HEIGHT = CELL_SIZE
const SELECTED_NOTE_COLOR = '#88178F'
const NOTE_COLOR = '#276C9E'

const allNotes = Array.from({ length: OCTAVES }, (_, octave) =>
  NOTES.map(note => `${note}${octave + 2}`)
).flat()

interface Note {
  id: string
  note: string
  start: number
  duration: number
  rowIndex: number
  colIndex: number
  selected: boolean
}

const Piano: React.FC<{
  activeNotes: string[]
  onNotePlay: (note: string) => void
  onNoteStop: (note: string) => void
}> = ({ activeNotes, onNotePlay, onNoteStop }) => {
  return (
    <div className="w-20 flex-shrink-0 mr-1">
      {allNotes.reverse().map((note) => (
        <div
          key={note}
          className={`h-6 flex items-center ${
            note.includes('#')
              ? 'bg-gray-900 text-white justify-center'
              : 'bg-white text-gray-900 justify-end pr-2'
          } ${activeNotes.includes(note) ? 'bg-blue-500' : ''}`}
          onMouseDown={() => onNotePlay(note)}
          onMouseUp={() => onNoteStop(note)}
          onMouseLeave={() => onNoteStop(note)}
        >
          <span className="text-xs">{note}</span>
        </div>
      ))}
    </div>
  )
}

const drawGrid = (ctx: CanvasRenderingContext2D, numberOfRows: number, numberOfColumns: number) => {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.beginPath()
  for (let row = 0; row < numberOfRows; row++) {
    for (let col = 0; col < numberOfColumns; col++) {
      ctx.rect(col * CELL_SIZE, row * CELL_SIZE, CELL_SIZE, CELL_SIZE)
    }
  }
  ctx.strokeStyle = 'lightgray'
  ctx.stroke()
}

const drawNote = (ctx: CanvasRenderingContext2D, note: Note) => {
  const x = note.colIndex * NOTE_WIDTH
  const y = note.rowIndex * NOTE_HEIGHT
  const width = NOTE_WIDTH * note.duration
  const height = NOTE_HEIGHT
  const noteColor = note.selected ? SELECTED_NOTE_COLOR : NOTE_COLOR

  ctx.fillStyle = noteColor
  ctx.fillRect(x, y, width, height)

  ctx.fillStyle = 'white'
  ctx.font = '10px Arial'
  ctx.fillText(note.note, x + 2, y + height / 2 + 4)

  // Draw resize handle
  ctx.fillStyle = 'white'
  ctx.fillRect(x + width - 5, y + height - 5, 5, 5)
}

const StaffView: React.FC<{ notes: Note[] }> = ({ notes }) => {
  const staffRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (staffRef.current) {
      staffRef.current.innerHTML = ''
      const renderer = new Renderer(staffRef.current, Renderer.Backends.SVG)
      renderer.resize(800, 200)
      const context = renderer.getContext()

      const stave = new Stave(10, 40, 780)
      stave.addClef('treble').addTimeSignature('4/4')
      stave.setContext(context).draw()

      const vexflowNotes = notes.flatMap(note => {
        const [noteName, octave] = note.note.split(/(\d+)/)
        const baseNote = `${noteName.toLowerCase()}/${octave}`
        
        // Convert duration to VexFlow format
        const getDuration = (duration: number) => {
          if (duration >= 4) return 'w'
          if (duration >= 2) return 'h'
          if (duration >= 1) return 'q'
          return '8'
        }

        // Split long notes into tied notes
        const splitNote = (duration: number): StaveNote[] => {
          const result: StaveNote[] = []
          let remainingDuration = duration

          while (remainingDuration > 0) {
            const currentDuration = Math.min(remainingDuration, 4)
            const vfDuration = getDuration(currentDuration)
            const newNote = new StaveNote({
              clef: 'treble',
              keys: [baseNote],
              duration: vfDuration
            })

            if (result.length > 0) {
              newNote.addModifier(new Vex.Flow.TieNote(), 0)
            }

            result.push(newNote)
            remainingDuration -= currentDuration
          }

          return result
        }

        return splitNote(note.duration / 4) // Convert from 16th notes to quarter notes
      })

      Formatter.FormatAndDraw(context, stave, vexflowNotes)

      // Add beams
      const beams = Beam.generateBeams(vexflowNotes)
      beams.forEach(beam => beam.setContext(context).draw())
    }
  }, [notes])

  return <div ref={staffRef} className="mt-4 bg-white p-4 rounded-lg" />
}

export function EnhancedInteractivePianoRollWithPythagoreanChords() {
  const [synth, setSynth] = useState<Tone.PolySynth | null>(null)
  const [activeNotes, setActiveNotes] = useState<string[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [isPlaying, setIsPlaying] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const [selectedNote, setSelectedNote] = useState<Note | null>(null)
  const [numberOfColumns, setNumberOfColumns] = useState(MEASURES * BEATS_PER_MEASURE * 4)
  const [showStaffView, setShowStaffView] = useState(false)

  const gridCanvasRef = useRef<HTMLCanvasElement>(null)
  const notesCanvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const newSynth = new Tone.PolySynth(Tone.Synth).toDestination()
    setSynth(newSynth)

    return () => {
      newSynth.dispose()
    }
  }, [])

  const drawAllNotes = useCallback(() => {
    if (!notesCanvasRef.current) return
    const ctx = notesCanvasRef.current.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    notes.forEach(note => drawNote(ctx, note))
  }, [notes])

  useEffect(() => {
    if (!gridCanvasRef.current) return
    const ctx = gridCanvasRef.current.getContext('2d')
    if (!ctx) return

    drawGrid(ctx, allNotes.length, numberOfColumns)
  }, [numberOfColumns])

  useEffect(() => {
    drawAllNotes()
  }, [drawAllNotes])

  const playNote = useCallback((note: string) => {
    if (synth) {
      synth.triggerAttackRelease(note, '8n')
      setActiveNotes(prev => [...prev, note])
    }
  }, [synth])

  const stopNote = useCallback((note: string) => {
    setActiveNotes(prev => prev.filter(n => n !== note))
  }, [])

  const handleNotePlay = (note: string) => {
    playNote(note)
  }

  const handleNoteStop = (note: string) => {
    stopNote(note)
  }

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!notesCanvasRef.current) return
    const rect = notesCanvasRef.current.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top

    const colIndex = Math.floor(x / CELL_SIZE)
    const rowIndex = Math.floor(y / CELL_SIZE)

    const clickedNote = notes.find(note =>
      note.rowIndex === rowIndex &&
      colIndex >= note.colIndex &&
      colIndex < note.colIndex + note.duration
    )

    if (clickedNote) {
      setSelectedNote(clickedNote)
      setNotes(prevNotes => prevNotes.map(note => ({
        ...note,
        selected: note.id === clickedNote.id
      })))
    } else if (!isDragging && !isResizing) {
      const newNote: Note = {
        id: `note-${Date.now()}`,
        note: allNotes[rowIndex],
        start: colIndex,
        duration: 1,
        rowIndex,
        colIndex,
        selected: true,
      }
      setNotes(prevNotes => [...prevNotes.map(note => ({ ...note, selected: false })), newNote])
      setSelectedNote(newNote)
      playNote(newNote.note)

      if (colIndex >= numberOfColumns - 1) {
        setNumberOfColumns(prevCols => prevCols + 50)
      }
    }

    drawAllNotes()
  }

  const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!notesCanvasRef.current) return
    const rect = notesCanvasRef.current.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top

    const colIndex = Math.floor(x / CELL_SIZE)
    const rowIndex = Math.floor(y / CELL_SIZE)

    const clickedNote = notes.find(note =>
      note.rowIndex === rowIndex &&
      colIndex >= note.colIndex &&
      colIndex < note.colIndex + note.duration
    )

    if (clickedNote) {
      setSelectedNote(clickedNote)
      const isResizeHandle = (x - clickedNote.colIndex * CELL_SIZE) > (clickedNote.duration * CELL_SIZE - 5)
      if (isResizeHandle) {
        setIsResizing(true)
      } else {
        setIsDragging(true)
      }
    }
  }

  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if ((isDragging || isResizing) && selectedNote && notesCanvasRef.current) {
      const rect = notesCanvasRef.current.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top

      const newColIndex = Math.floor(x / CELL_SIZE)
      const newRowIndex = Math.floor(y / CELL_SIZE)

      if (isDragging) {
        setNotes(prevNotes => prevNotes.map(note =>
          note.id === selectedNote.id
            ? { ...note, colIndex: newColIndex, rowIndex: newRowIndex, note: allNotes[newRowIndex] }
            : note
        ))
      } else if (isResizing) {
        const newDuration = Math.max(1, newColIndex - selectedNote.colIndex + 1)
        setNotes(prevNotes => prevNotes.map(note =>
          note.id === selectedNote.id
            ? { ...note, duration: newDuration }
            : note
        ))
      }

      drawAllNotes()
    }
  }

  const handleMouseUp = () => {
    setIsDragging(false)
    setIsResizing(false)
  }

  const playRecorded = useCallback(() => {
    if (synth && !isPlaying) {
      setIsPlaying(true)
      Tone.Transport.cancel()
      Tone.Transport.stop()
      Tone.Transport.position = 0

      const now = Tone.now()
      notes.forEach(({ note, start, duration }) => {
        synth.triggerAttackRelease(note, duration * 0.25, now + start * 0.25)
      })

      const maxDuration = Math.max(...notes.map(n => n.start + n.duration)) * 0.25
      Tone.Transport.schedule(() => {
        setIsPlaying(false)
      }, maxDuration)

      Tone.Transport.start()
    }
  }, [synth, notes, isPlaying])

  const stopPlayback = () => {
    Tone.Transport.stop()
    Tone.Transport.cancel()
    setIsPlaying(false)
    if (synth) {
      synth.releaseAll()
    }
  }

  const clearAllNotes = () => {
    setNotes([])
    drawAllNotes()
  }

  const addRandomNote = () => {
    const rowIndex = Math.floor(Math.random() * allNotes.length)
    const colIndex = Math.floor(Math.random() * numberOfColumns)
    const duration = Math.floor(Math.random() * 4) + 1

    const newNote: Note = {
      id: `note-${Date.now()}`,
      note: allNotes[rowIndex],
      start: colIndex,
      duration,
      rowIndex,
      colIndex,
      selected: false,
    }

    setNotes(prevNotes => [...prevNotes, newNote])
    drawAllNotes()
  }

  const handleMidiUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const arrayBuffer = await file.arrayBuffer()
      const midi = new Midi(arrayBuffer)

      const newNotes: Note[] = []
      let maxColumn = 0

      midi.tracks.forEach((track) => {
        track.notes.forEach((midiNote) => {
          const noteName = midiNote.name
          const start = Math.floor(midiNote.time * 4) // Convert to 16th notes
          const duration = Math.ceil(midiNote.duration * 4) // Convert to 16th notes
          const rowIndex = allNotes.indexOf(noteName)
          const colIndex = start

          if (rowIndex !== -1) {
            newNotes.push({
              id: `note-${Date.now()}-${Math.random()}`,
              note: noteName,
              start,
              duration,
              rowIndex,
              colIndex,
              selected: false,
            })

            maxColumn = Math.max(maxColumn, colIndex + duration)
          }
        })
      })

      setNotes(newNotes)
      setNumberOfColumns(Math.max(numberOfColumns, maxColumn + 1))
      drawAllNotes()

      toast({
        title: "MIDI file uploaded successfully",
        description: `Loaded ${newNotes.length} notes from the MIDI file.`,
      })
    } catch (error) {
      console.error('Error parsing MIDI file:', error)
      toast({
        title: "Error uploading MIDI file",
        description: "There was a problem processing the MIDI file. Please try again with a different file.",
        variant: "destructive",
      })
    }
  }

  const addPythagoreanChords = () => {
    const baseNote = 'C4'
    const baseFrequency = 261.63 // Frequency of C4

    const pythagoreanRatios = [
      { name: 'Perfect Fourth', ratio: 4/3 },
      { name: 'Perfect Fifth', ratio: 3/2 },
      { name: 'Major Third', ratio: 81/64 },
      { name: 'Minor Third', ratio: 32/27 },
    ]

    const newChords: Note[] = []

    pythagoreanRatios.forEach((interval, index) => {
      const frequency = baseFrequency * interval.ratio
      const note = Tone.Frequency(frequency).toNote()
      
      newChords.push({
        id: `pythagorean-${Date.now()}-${index}`,
        note: note,
        start: index * 4,
        duration: 4,
        rowIndex: allNotes.indexOf(note),
        colIndex: index * 4,
        selected: false,
      })
    })

    // Add the base note
    newChords.push({
      id: `pythagorean-${Date.now()}-base`,
      note: baseNote,
      start: 0,
      duration: 16,
      rowIndex: allNotes.indexOf(baseNote),
      colIndex: 0,
      selected: false,
    })

    setNotes(prevNotes => [...prevNotes, ...newChords])
    drawAllNotes()

    toast({
      title: "Pythagorean chords added",
      description: "Added Perfect Fourth, Perfect Fifth, Major Third, and Minor Third chords.",
    })
  }

  return (
    <div className="bg-gray-800 p-4 rounded-lg shadow-lg">
      <div className="flex mb-4 space-x-2 flex-wrap">
        <Button
          className="bg-blue-500 hover:bg-blue-700 mb-2"
          onClick={() => Tone.start()}
        >
          Start Audio Context
        </Button>
        <Button
          className={`${isPlaying ? 'bg-red-500 hover:bg-red-700' : 'bg-green-500 hover:bg-green-700'} mb-2`}
          onClick={isPlaying ? stopPlayback : playRecorded}
        >
          {isPlaying ? <Square className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
          {isPlaying ? 'Stop' : 'Play Recorded'}
        </Button>
        <Button
          className="bg-purple-500 hover:bg-purple-700 mb-2"
          onClick={addRandomNote}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add Random Note
        </Button>
        <Button
          className="bg-yellow-500 hover:bg-yellow-700 mb-2"
          onClick={clearAllNotes}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Clear All Notes
        </Button>
        <div className="relative">
          <Input
            type="file"
            accept=".mid,.midi"
            onChange={handleMidiUpload}
            className="hidden"
            id="midi-upload"
          />
          <Button
            className="bg-indigo-500 hover:bg-indigo-700 mb-2"
            onClick={() => document.getElementById('midi-upload')?.click()}
          >
            <Upload className="mr-2 h-4 w-4" />
            Upload MIDI
          </Button>
        </div>
        <Button
          className="bg-teal-500 hover:bg-teal-700 mb-2"
          onClick={addPythagoreanChords}
        >
          <ChevronUp className="mr-2 h-4 w-4" />
          Add Pythagorean Chords
        </Button>
        <div className="flex items-center space-x-2 mb-2">
          <Switch
            id="staff-view"
            checked={showStaffView}
            onCheckedChange={setShowStaffView}
          />
          <label htmlFor="staff-view" className="text-white">
            <Music className="inline-block mr-2 h-4 w-4" />
            Staff View
          </label>
        </div>
      </div>
      <div className="flex">
        <Piano
          activeNotes={activeNotes}
          onNotePlay={handleNotePlay}
          onNoteStop={handleNoteStop}
        />
        <div className="relative">
          <canvas
            ref={gridCanvasRef}
            width={numberOfColumns * CELL_SIZE}
            height={allNotes.length * CELL_SIZE}
            className="absolute top-0 left-0 z-0"
          />
          <canvas
            ref={notesCanvasRef}
            width={numberOfColumns * CELL_SIZE}
            height={allNotes.length * CELL_SIZE}
            className="absolute top-0 left-0 z-10"
            onClick={handleCanvasClick}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          />
        </div>
      </div>
      {showStaffView && <StaffView notes={notes} />}
    </div>
  )
}