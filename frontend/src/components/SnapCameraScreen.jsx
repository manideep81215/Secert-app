import { useEffect, useRef, useState } from 'react'
import './SnapCamera.css'

const FILTERS = ['none', 'warm', 'cool', 'vintage', 'fade', 'dark', 'gold']
const TIMERS = ['off', '3s', '10s']
const ZOOMS = ['0.5x', '1x', '2x', '5x']
const MODE_TABS = ['camera', 'video']
const MODE_LABELS = {
  camera: 'PHOTO',
  video: 'VIDEO',
}
const SNAP_CAPTURE_WIDTH = 1080
const SNAP_CAPTURE_HEIGHT = 1920
const SNAP_CAPTURE_FPS = 30

function getNineBySixteenCrop(sourceWidth, sourceHeight) {
  const sourceAspect = sourceWidth / sourceHeight
  const targetAspect = SNAP_CAPTURE_WIDTH / SNAP_CAPTURE_HEIGHT

  if (sourceAspect > targetAspect) {
    const croppedWidth = sourceHeight * targetAspect
    return {
      sx: Math.max(0, (sourceWidth - croppedWidth) / 2),
      sy: 0,
      sw: croppedWidth,
      sh: sourceHeight,
    }
  }

  const croppedHeight = sourceWidth / targetAspect
  return {
    sx: 0,
    sy: Math.max(0, (sourceHeight - croppedHeight) / 2),
    sw: sourceWidth,
    sh: croppedHeight,
  }
}

function drawVideoFrameToCanvas({ sourceVideo, targetCanvas, mirror = false }) {
  const sourceWidth = Number(sourceVideo?.videoWidth || 0)
  const sourceHeight = Number(sourceVideo?.videoHeight || 0)
  if (!sourceWidth || !sourceHeight || !targetCanvas) return false

  const context = targetCanvas.getContext('2d')
  if (!context) return false

  const { sx, sy, sw, sh } = getNineBySixteenCrop(sourceWidth, sourceHeight)
  context.save()
  context.clearRect(0, 0, targetCanvas.width, targetCanvas.height)
  if (mirror) {
    context.translate(targetCanvas.width, 0)
    context.scale(-1, 1)
  }
  context.drawImage(
    sourceVideo,
    sx,
    sy,
    sw,
    sh,
    0,
    0,
    targetCanvas.width,
    targetCanvas.height,
  )
  context.restore()
  return true
}

function normalizeVideoMimeType(rawType, fileName) {
  const normalizedType = String(rawType || '').trim().toLowerCase()
  if (normalizedType.startsWith('video/mp4')) return 'video/mp4'
  if (normalizedType.startsWith('video/webm')) return 'video/webm'
  if (normalizedType.startsWith('video/quicktime')) return 'video/quicktime'
  if (normalizedType.startsWith('video/x-quicktime')) return 'video/quicktime'
  if (normalizedType.startsWith('video/3gpp2')) return 'video/3gpp2'
  if (normalizedType.startsWith('video/3gpp')) return 'video/3gpp'

  const normalizedName = String(fileName || '').trim().toLowerCase()
  if (normalizedName.endsWith('.mp4') || normalizedName.endsWith('.m4v')) return 'video/mp4'
  if (normalizedName.endsWith('.mov') || normalizedName.endsWith('.qt')) return 'video/quicktime'
  if (normalizedName.endsWith('.3g2')) return 'video/3gpp2'
  if (normalizedName.endsWith('.webm')) return 'video/webm'
  if (normalizedName.endsWith('.3gp')) return 'video/3gpp'
  return 'video/webm'
}

function buildVideoFile(inputBlob, inputName, inputType) {
  const mimeType = normalizeVideoMimeType(inputType, inputName)
  const extension = mimeType === 'video/mp4'
    ? 'mp4'
    : mimeType === 'video/quicktime'
      ? 'mov'
      : mimeType === 'video/3gpp2'
        ? '3g2'
        : mimeType === 'video/3gpp'
          ? '3gp'
          : 'webm'
  const normalizedName = String(inputName || '').trim() || `snap_${Date.now()}.${extension}`
  const fileName = /\.[a-z0-9]+$/i.test(normalizedName) ? normalizedName : `${normalizedName}.${extension}`
  return new File([inputBlob], fileName, {
    type: mimeType,
    lastModified: Date.now(),
  })
}

function getSelectedMediaKind(inputFile) {
  const mime = String(inputFile?.type || '').trim().toLowerCase()
  const name = String(inputFile?.name || '').trim().toLowerCase()
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('image/')) return 'photo'
  if (/\.(mp4|mov|qt|m4v|webm|mkv|avi|3gp|3g2)$/i.test(name)) return 'video'
  if (/\.(jpg|jpeg|png|gif|webp|heic|heics|heif|heifs|hif|bmp|svg)$/i.test(name)) return 'photo'
  return null
}

function countdown(secs) {
  return new Promise((resolve) => {
    let count = secs
    const interval = window.setInterval(() => {
      count -= 1
      if (count <= 0) {
        window.clearInterval(interval)
        resolve()
      }
    }, 1000)
  })
}

export default function SnapCameraScreen({ currentUser, otherUser, onClose, onSend }) {
  const [mode, setMode] = useState('camera')
  const [filter, setFilter] = useState('none')
  const [timer, setTimer] = useState('off')
  const [zoom, setZoom] = useState('1x')
  const [flash, setFlash] = useState(false)
  const [frontCam, setFront] = useState(false)
  const [preview, setPreview] = useState(null)
  const [file, setFile] = useState(null)
  const [capturedType, setCapturedType] = useState('photo')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const recordedChunksRef = useRef([])
  const recordingTimerRef = useRef(null)
  const stopRecordingModeRef = useRef('preview')
  const mountedRef = useRef(false)
  const previewUrlRef = useRef(null)
  const libraryInputRef = useRef(null)
  const captureCanvasRef = useRef(null)
  const captureFrameRequestRef = useRef(0)
  const recordingOutputStreamRef = useRef(null)

  function clearPreviewUrl(url) {
    const value = String(url || '').trim()
    if (value.startsWith('blob:')) {
      URL.revokeObjectURL(value)
    }
  }

  function replacePreviewUrl(nextUrl) {
    const normalizedNext = String(nextUrl || '').trim() || null
    const previousUrl = previewUrlRef.current
    if (previousUrl && previousUrl !== normalizedNext) {
      clearPreviewUrl(previousUrl)
    }
    previewUrlRef.current = normalizedNext
    setPreview(normalizedNext)
  }

  function stopRecordingTimer() {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
  }

  function ensureCaptureCanvas() {
    if (!captureCanvasRef.current && typeof document !== 'undefined') {
      const canvas = document.createElement('canvas')
      canvas.width = SNAP_CAPTURE_WIDTH
      canvas.height = SNAP_CAPTURE_HEIGHT
      captureCanvasRef.current = canvas
    }
    return captureCanvasRef.current
  }

  function renderCaptureFrame() {
    const captureCanvas = ensureCaptureCanvas()
    const activeVideo = videoRef.current
    if (!captureCanvas || !activeVideo) return false
    return drawVideoFrameToCanvas({
      sourceVideo: activeVideo,
      targetCanvas: captureCanvas,
      mirror: frontCam,
    })
  }

  function stopCaptureComposition() {
    if (captureFrameRequestRef.current) {
      window.cancelAnimationFrame(captureFrameRequestRef.current)
      captureFrameRequestRef.current = 0
    }
  }

  function startCaptureComposition() {
    stopCaptureComposition()
    const tick = () => {
      if (!mountedRef.current || !streamRef.current) {
        captureFrameRequestRef.current = 0
        return
      }
      renderCaptureFrame()
      captureFrameRequestRef.current = window.requestAnimationFrame(tick)
    }
    renderCaptureFrame()
    captureFrameRequestRef.current = window.requestAnimationFrame(tick)
  }

  function stopRecordingOutputStream() {
    recordingOutputStreamRef.current?.getTracks?.().forEach((track) => track.stop())
    recordingOutputStreamRef.current = null
  }

  function stopPreview() {
    stopCaptureComposition()
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    streamRef.current?.getTracks?.().forEach((track) => track.stop())
    streamRef.current = null
  }

  function clearCapturedMedia() {
    replacePreviewUrl(null)
    setFile(null)
    setCapturedType('photo')
    setSent(false)
  }

  async function startPreview() {
    try {
      stopPreview()
      const buildConstraints = (withAudio) => ({
        video: {
          facingMode: frontCam ? 'user' : 'environment',
          width: { ideal: 1080 },
          height: { ideal: 1920 },
        },
        audio: withAudio
          ? {
              echoCancellation: true,
              noiseSuppression: true,
            }
          : false,
      })

      const wantsAudio = mode === 'video'
      let stream = null
      try {
        stream = await navigator.mediaDevices.getUserMedia(buildConstraints(wantsAudio))
      } catch (error) {
        if (!wantsAudio) throw error
        stream = await navigator.mediaDevices.getUserMedia(buildConstraints(false))
      }

      if (!mountedRef.current) {
        stream?.getTracks?.().forEach((track) => track.stop())
        return
      }

      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      startCaptureComposition()
    } catch (error) {
      console.error('Camera preview error:', error)
    }
  }

  async function ensurePreviewReady() {
    if (!streamRef.current) {
      await startPreview()
    }
    const activeVideo = videoRef.current
    if (!activeVideo) return null
    if (activeVideo.readyState >= 2) return activeVideo

    await new Promise((resolve) => {
      const timeoutId = window.setTimeout(resolve, 450)
      const handleLoadedData = () => {
        window.clearTimeout(timeoutId)
        resolve()
      }
      activeVideo.addEventListener('loadeddata', handleLoadedData, { once: true })
    })

    renderCaptureFrame()
    return videoRef.current
  }

  function acceptCapturedPhoto(inputFile) {
    if (!inputFile) return
    clearCapturedMedia()
    setFile(inputFile)
    setCapturedType('photo')
    replacePreviewUrl(URL.createObjectURL(inputFile))
  }

  function acceptCapturedVideo(inputFile) {
    if (!inputFile) return
    const preparedFile = buildVideoFile(inputFile, inputFile.name, inputFile.type)
    clearCapturedMedia()
    setFile(preparedFile)
    setCapturedType('video')
    replacePreviewUrl(URL.createObjectURL(preparedFile))
  }

  function finalizeRecordedVideo(mimeType) {
    const discardRecording = stopRecordingModeRef.current === 'discard'
    const chunks = [...recordedChunksRef.current]
    recordedChunksRef.current = []
    mediaRecorderRef.current = null
    stopRecordingTimer()
    stopRecordingOutputStream()

    if (mountedRef.current) {
      setIsRecording(false)
      setRecordingSeconds(0)
    }

    if (discardRecording || !chunks.length || !mountedRef.current) {
      return
    }

    const resolvedMimeType = normalizeVideoMimeType(mimeType || chunks[0]?.type, '')
    const blob = new Blob(chunks, { type: resolvedMimeType })
    acceptCapturedVideo(buildVideoFile(blob, `snap_${Date.now()}`, resolvedMimeType))
  }

  function stopVideoRecording({ discard = false } = {}) {
    const recorder = mediaRecorderRef.current
    stopRecordingModeRef.current = discard ? 'discard' : 'preview'
    if (!recorder) {
      stopRecordingTimer()
      stopRecordingOutputStream()
      if (mountedRef.current) {
        setIsRecording(false)
        setRecordingSeconds(0)
      }
      return
    }

    if (recorder.state !== 'inactive') {
      recorder.stop()
      return
    }

    finalizeRecordedVideo(recorder.mimeType)
  }

  async function capturePhoto() {
    const timerSecs = timer === '3s' ? 3 : timer === '10s' ? 10 : 0
    if (timerSecs > 0) {
      await countdown(timerSecs)
    }

    const activeVideo = await ensurePreviewReady()
    const captureCanvas = ensureCaptureCanvas()
    if (!activeVideo || !captureCanvas) return
    if (!renderCaptureFrame()) return

    captureCanvas.toBlob((blob) => {
      if (!blob) return
      const snapFile = new File([blob], `snap_${Date.now()}.jpg`, {
        type: 'image/jpeg',
      })
      acceptCapturedPhoto(snapFile)
    }, 'image/jpeg', 0.9)
  }

  async function startVideoRecording() {
    const timerSecs = timer === '3s' ? 3 : timer === '10s' ? 10 : 0
    if (timerSecs > 0) {
      await countdown(timerSecs)
    }

    const activeVideo = await ensurePreviewReady()
    const stream = streamRef.current
    const captureCanvas = ensureCaptureCanvas()
    if (!activeVideo || !stream || !captureCanvas) return
    if (typeof MediaRecorder === 'undefined') {
      console.error('MediaRecorder is not available in this runtime.')
      return
    }
    if (!renderCaptureFrame()) return

    startCaptureComposition()
    const canvasStream = captureCanvas.captureStream(SNAP_CAPTURE_FPS)
    const outputStream = new MediaStream()
    canvasStream.getVideoTracks().forEach((track) => outputStream.addTrack(track))
    stream.getAudioTracks().forEach((track) => {
      const clonedTrack = typeof track.clone === 'function' ? track.clone() : track
      outputStream.addTrack(clonedTrack)
    })
    recordingOutputStreamRef.current = outputStream

    const preferredMimeTypes = [
      'video/mp4;codecs=h264,aac',
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=h264,opus',
      'video/webm',
    ]
    const supportedMimeType = preferredMimeTypes.find((value) => MediaRecorder.isTypeSupported?.(value))
    const recorder = supportedMimeType
      ? new MediaRecorder(outputStream, { mimeType: supportedMimeType })
      : new MediaRecorder(outputStream)

    stopRecordingModeRef.current = 'preview'
    recordedChunksRef.current = []
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunksRef.current.push(event.data)
      }
    }
    recorder.onstop = () => {
      finalizeRecordedVideo(recorder.mimeType)
    }
    recorder.onerror = (event) => {
      console.error('Video recording error:', event)
      stopVideoRecording({ discard: true })
    }

    mediaRecorderRef.current = recorder
    recorder.start(250)
    setIsRecording(true)
    setRecordingSeconds(0)
    stopRecordingTimer()
    recordingTimerRef.current = window.setInterval(() => {
      setRecordingSeconds((prev) => prev + 1)
    }, 1000)
  }

  async function handleShutterPress() {
    if (isRecording) {
      stopVideoRecording()
      return
    }

    if (mode === 'video') {
      await startVideoRecording()
      return
    }

    await capturePhoto()
  }

  function handleLibraryButtonPress() {
    libraryInputRef.current?.click()
  }

  function handleLibraryInputChange(event) {
    const selectedFile = event?.target?.files?.[0]
    if (!selectedFile) {
      if (event?.target) event.target.value = ''
      return
    }

    const mediaKind = getSelectedMediaKind(selectedFile)
    if (mediaKind === 'video') {
      acceptCapturedVideo(selectedFile)
    } else {
      acceptCapturedPhoto(selectedFile)
    }

    if (event?.target) {
      event.target.value = ''
    }
  }

  async function sendSnap() {
    if (!file) return
    setSending(true)

    try {
      if (typeof onSend !== 'function') {
        throw new Error('snap-send-handler-missing')
      }
      const didSend = await onSend(file, capturedType)
      if (!didSend) {
        return
      }

      setSent(true)
      window.setTimeout(() => {
        setSent(false)
        clearCapturedMedia()
        onClose?.()
      }, 1500)
    } catch (error) {
      console.error('Snap send failed:', error)
    } finally {
      setSending(false)
    }
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      stopVideoRecording({ discard: true })
      stopPreview()
      stopCaptureComposition()
      stopRecordingOutputStream()
      clearPreviewUrl(previewUrlRef.current)
      previewUrlRef.current = null
      captureCanvasRef.current = null
    }
  }, [])

  useEffect(() => {
    void startPreview()
    return () => {
      stopVideoRecording({ discard: true })
      stopPreview()
    }
  }, [frontCam, mode])

  const previewImageClassName = filter !== 'none' ? `filter-${filter}` : ''

  return (
    <div className="snap-screen">
      <div className="snap-stage">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`snap-video ${previewImageClassName}`}
          style={{ transform: frontCam ? 'scaleX(-1)' : 'none' }}
        />

        {preview && (
          <div className="snap-preview">
            {capturedType === 'video' ? (
              <video
                src={preview}
                className="snap-preview-video"
                controls
                autoPlay
                playsInline
              />
            ) : (
              <img src={preview} alt="snap preview" className={previewImageClassName} />
            )}

            <button className="send-btn" onClick={sendSnap} disabled={sending} type="button">
              {sending ? 'Sending' : 'Send'}
            </button>

            <button className="discard-btn" onClick={clearCapturedMedia} type="button">
              Back
            </button>

            {capturedType === 'photo' && (
              <div className="edit-tools">
                <button type="button">Text</button>
                <button type="button">Draw</button>
                <button type="button">Emoji</button>
                <button type="button">Note</button>
              </div>
            )}

            {sent && (
              <div className="sent-overlay">
                <div className="sent-check">OK</div>
                <p>Sent {capturedType} to {otherUser || currentUser}!</p>
              </div>
            )}
          </div>
        )}
      </div>

      {!preview && (
        <>
          <div className="top-bar">
            <button className="icon-btn" onClick={onClose} type="button">Close</button>
            <button
              className={`icon-btn ${flash ? 'flash-on' : ''}`}
              onClick={() => setFlash(!flash)}
              type="button"
            >
              {flash ? 'Flash On' : 'Flash'}
            </button>
            <button className="icon-btn" onClick={() => setFilter('none')} type="button">Clear FX</button>
          </div>

          {isRecording && (
            <div className="recording-pill">
              REC {recordingSeconds}s
            </div>
          )}

          <div className="timer-row">
            {TIMERS.map((value) => (
              <button
                key={value}
                className={`timer-btn ${timer === value ? 'active' : ''}`}
                onClick={() => setTimer(value)}
                disabled={isRecording}
                type="button"
              >
                {value}
              </button>
            ))}
          </div>

          <div className="filter-strip">
            {FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                className={`filter-dot filter-${value} ${filter === value ? 'active' : ''}`}
                onClick={() => !isRecording && setFilter(value)}
                aria-label={`Apply ${value} filter`}
              />
            ))}
          </div>

          <div className="zoom-pill">
            {ZOOMS.map((value) => (
              <button
                key={value}
                className={`zoom-btn ${zoom === value ? 'active' : ''}`}
                onClick={() => setZoom(value)}
                disabled={isRecording}
                type="button"
              >
                {value}
              </button>
            ))}
          </div>

          <div className="bottom-bar">
            <div className="mode-tabs">
              {MODE_TABS.map((value) => (
                <button
                  key={value}
                  className={`mode-tab ${mode === value ? 'active' : ''}`}
                  onClick={() => setMode(value)}
                  disabled={isRecording}
                  type="button"
                >
                  {MODE_LABELS[value] || value.toUpperCase()}
                </button>
              ))}
            </div>

            <div className="capture-row">
              <button className="gallery-btn" onClick={handleLibraryButtonPress} type="button">Library</button>
              <button
                className={`shutter ${mode === 'video' ? 'video-mode' : ''} ${isRecording ? 'recording' : ''}`}
                onClick={handleShutterPress}
                aria-label={isRecording ? 'Stop video recording' : (mode === 'video' ? 'Start video recording' : 'Capture photo')}
                type="button"
              />
              <button className="flip-btn" onClick={() => setFront(!frontCam)} disabled={isRecording} type="button">Flip</button>
            </div>
          </div>
        </>
      )}

      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*,video/*"
        style={{ display: 'none' }}
        onChange={handleLibraryInputChange}
      />
    </div>
  )
}
