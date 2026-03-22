import { useEffect, useRef, useState } from 'react'
import { Camera, CameraSource, CameraResultType } from '@capacitor/camera'
import { Filesystem } from '@capacitor/filesystem'
import { Capacitor } from '@capacitor/core'
import './SnapCamera.css'

const FILTERS = ['none', 'warm', 'cool', 'vintage', 'fade', 'dark', 'gold']
const TIMERS = ['off', '3s', '10s']
const ZOOMS = ['0.5x', '1x', '2x', '5x']
const MODE_TABS = ['camera', 'video']

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
  const nativeVideoInputRef = useRef(null)
  const isNativeAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform?.() === 'android'

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    void startPreview()
    return () => {
      stopVideoRecording({ discard: true })
      stopPreview()
    }
  }, [frontCam, mode])

  useEffect(() => () => {
    clearCapturedMedia()
    stopRecordingTimer()
  }, [])

  function clearPreviewUrl(url) {
    const value = String(url || '').trim()
    if (value.startsWith('blob:')) {
      URL.revokeObjectURL(value)
    }
  }

  function clearCapturedMedia() {
    setPreview((prev) => {
      clearPreviewUrl(prev)
      return null
    })
    setFile(null)
    setCapturedType('photo')
    setSent(false)
  }

  function stopRecordingTimer() {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
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
    } catch (error) {
      console.error('Camera error:', error)
    }
  }

  function stopPreview() {
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  function base64ToBlob(base64Data, mimeType) {
    const binary = window.atob(base64Data)
    const len = binary.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    return new Blob([bytes], { type: mimeType || 'application/octet-stream' })
  }

  function normalizeVideoMimeType(rawType, fileName) {
    const normalizedType = String(rawType || '').trim().toLowerCase()
    if (normalizedType.startsWith('video/mp4')) return 'video/mp4'
    if (normalizedType.startsWith('video/webm')) return 'video/webm'
    if (normalizedType.startsWith('video/quicktime')) return 'video/quicktime'

    const normalizedName = String(fileName || '').trim().toLowerCase()
    if (normalizedName.endsWith('.mp4') || normalizedName.endsWith('.m4v')) return 'video/mp4'
    if (normalizedName.endsWith('.mov')) return 'video/quicktime'
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

  async function readNativePathBlob(path, mimeType) {
    const pathText = String(path || '').trim()
    if (!pathText) return null
    try {
      const read = await Filesystem.readFile({ path: pathText })
      const rawData = read?.data
      if (!rawData) return null
      if (rawData instanceof Blob) return rawData
      const base64Data = String(rawData).split(',').pop() || ''
      if (!base64Data) return null
      return base64ToBlob(base64Data, mimeType)
    } catch {
      return null
    }
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

  async function capturePhoto() {
    const timerSecs = timer === '3s' ? 3 : timer === '10s' ? 10 : 0
    if (timerSecs > 0) {
      await countdown(timerSecs)
    }

    if (Capacitor.isNativePlatform()) {
      const image = await Camera.getPhoto({
        source: CameraSource.Camera,
        resultType: CameraResultType.Uri,
        quality: 90,
        correctOrientation: true,
      })

      let blob = await readNativePathBlob(image?.path, 'image/jpeg')
      if (!blob) {
        const webPath = String(image?.webPath || '').trim()
        if (!webPath) throw new Error('snap-photo-path-missing')
        const response = await fetch(webPath)
        if (!response.ok) throw new Error(`snap-photo-fetch-failed-${response.status}`)
        blob = await response.blob()
      }

      const snapFile = new File([blob], `snap_${Date.now()}.jpg`, {
        type: 'image/jpeg',
      })
      clearCapturedMedia()
      setFile(snapFile)
      setCapturedType('photo')
      setPreview(URL.createObjectURL(snapFile))
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = videoRef.current?.videoWidth || 1080
    canvas.height = videoRef.current?.videoHeight || 1920
    canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0)
    canvas.toBlob((blob) => {
      if (!blob) return
      const snapFile = new File([blob], `snap_${Date.now()}.jpg`, {
        type: 'image/jpeg',
      })
      clearCapturedMedia()
      setFile(snapFile)
      setCapturedType('photo')
      setPreview(URL.createObjectURL(snapFile))
    }, 'image/jpeg', 0.9)
  }

  function acceptCapturedVideo(inputFile) {
    if (!inputFile) return
    const preparedFile = buildVideoFile(inputFile, inputFile.name, inputFile.type)
    clearCapturedMedia()
    setFile(preparedFile)
    setCapturedType('video')
    setPreview(URL.createObjectURL(preparedFile))
  }

  async function captureNativeAndroidVideo() {
    const timerSecs = timer === '3s' ? 3 : timer === '10s' ? 10 : 0
    if (timerSecs > 0) {
      await countdown(timerSecs)
    }

    const mediaCaptureApi = window?.navigator?.device?.capture
    if (!mediaCaptureApi?.captureVideo) {
      nativeVideoInputRef.current?.click()
      return
    }

    stopPreview()

    try {
      const capturedFiles = await new Promise((resolve, reject) => {
        mediaCaptureApi.captureVideo(
          (files) => resolve(Array.isArray(files) ? files : []),
          (error) => reject(error),
          { limit: 1, duration: 120, quality: 1 },
        )
      })
      const captured = Array.isArray(capturedFiles) ? capturedFiles[0] : null
      if (!captured) {
        if (mountedRef.current && !preview) {
          await startPreview()
        }
        return
      }

      const localPath = String(
        captured.fullPath ||
        captured.localURL ||
        captured.path ||
        '',
      ).trim()
      if (!localPath) {
        throw new Error('snap-video-empty-path')
      }

      const originalName = String(captured.name || '').trim()
      const mimeHint = normalizeVideoMimeType(captured.type, originalName)
      let blob = await readNativePathBlob(localPath, mimeHint)
      if (!blob) {
        const resolvedPath = window?.Capacitor?.convertFileSrc
          ? window.Capacitor.convertFileSrc(localPath)
          : localPath
        const response = await fetch(resolvedPath)
        if (!response.ok) {
          throw new Error(`snap-video-fetch-failed-${response.status}`)
        }
        blob = await response.blob()
      }

      const fileBaseName = originalName || `snap_${Date.now()}`
      acceptCapturedVideo(buildVideoFile(blob, fileBaseName, blob.type || mimeHint))
    } catch (error) {
      const code = Number(error?.code || 0)
      const rawMessage = String(error?.message || error || '').toLowerCase()
      const cancelled = (
        code === 3 ||
        rawMessage.includes('cancel') ||
        rawMessage.includes('no media files')
      )
      if (!cancelled) {
        console.error('Native snap video capture failed:', error)
      }
      if (mountedRef.current && !preview) {
        await startPreview()
      }
    }
  }

  function finalizeRecordedVideo(mimeType) {
    const discardRecording = stopRecordingModeRef.current === 'discard'
    const chunks = [...recordedChunksRef.current]
    recordedChunksRef.current = []
    mediaRecorderRef.current = null
    stopRecordingTimer()

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

  async function startVideoRecording() {
    const timerSecs = timer === '3s' ? 3 : timer === '10s' ? 10 : 0
    if (timerSecs > 0) {
      await countdown(timerSecs)
    }

    if (!streamRef.current) {
      await startPreview()
    }

    const stream = streamRef.current
    if (!stream) return
    if (typeof MediaRecorder === 'undefined') {
      console.error('MediaRecorder is not available in this runtime.')
      return
    }

    const preferredMimeTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=h264,opus',
      'video/webm',
      'video/mp4',
    ]
    const supportedMimeType = preferredMimeTypes.find((value) => MediaRecorder.isTypeSupported?.(value))
    const recorder = supportedMimeType
      ? new MediaRecorder(stream, { mimeType: supportedMimeType })
      : new MediaRecorder(stream)

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

  async function handleNativeVideoInputChange(event) {
    const selectedFile = event?.target?.files?.[0]
    if (selectedFile) {
      acceptCapturedVideo(selectedFile)
    }
    if (event?.target) {
      event.target.value = ''
    }
  }

  async function handleShutterPress() {
    if (isRecording) {
      stopVideoRecording()
      return
    }

    if (mode === 'video') {
      if (isNativeAndroid) {
        await captureNativeAndroidVideo()
        return
      }
      await startVideoRecording()
      return
    }

    await capturePhoto()
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

  return (
    <div className="snap-screen">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`snap-video ${filter !== 'none' ? `filter-${filter}` : ''}`}
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
            <img src={preview} alt="snap preview" className={`filter-${filter}`} />
          )}

          <button className="send-btn" onClick={sendSnap} disabled={sending}>
            {sending ? '...' : 'âž¤'}
          </button>

          <button className="discard-btn" onClick={clearCapturedMedia}>âœ•</button>

          {capturedType === 'photo' && (
            <div className="edit-tools">
              <button>T</button>
              <button>âœï¸</button>
              <button>ðŸ˜Š</button>
              <button>ðŸ“Ž</button>
            </div>
          )}

          {sent && (
            <div className="sent-overlay">
              <div className="sent-check">âœ“</div>
              <p>Sent {capturedType} to {otherUser || currentUser}!</p>
            </div>
          )}
        </div>
      )}

      {!preview && (
        <>
          <div className="top-bar">
            <button className="icon-btn" onClick={onClose}>âœ•</button>
            <button
              className={`icon-btn ${flash ? 'flash-on' : ''}`}
              onClick={() => setFlash(!flash)}
            >âš¡</button>
            <button className="icon-btn">ðŸ˜Š</button>
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
              >{value}</button>
            ))}
          </div>

          <div className="filter-strip">
            {FILTERS.map((value) => (
              <div
                key={value}
                className={`filter-dot filter-${value} ${filter === value ? 'active' : ''}`}
                onClick={() => !isRecording && setFilter(value)}
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
              >{value}</button>
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
                >{value.toUpperCase()}</button>
              ))}
            </div>

            <div className="capture-row">
              <button className="gallery-btn">ðŸ–¼</button>
              <button
                className={`shutter ${mode === 'video' ? 'video-mode' : ''} ${isRecording ? 'recording' : ''}`}
                onClick={handleShutterPress}
                aria-label={isRecording ? 'Stop video recording' : (mode === 'video' ? 'Start video recording' : 'Capture photo')}
              />
              <button className="flip-btn" onClick={() => setFront(!frontCam)} disabled={isRecording}>
                ðŸ”„
              </button>
            </div>
          </div>
        </>
      )}
      <input
        ref={nativeVideoInputRef}
        type="file"
        accept="video/mp4,video/*"
        capture="camcorder"
        style={{ display: 'none' }}
        onChange={handleNativeVideoInputChange}
      />
    </div>
  )
}
