import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import { Capacitor } from '@capacitor/core'
import { useEffect, useRef, useState } from 'react'
import './SnapCamera.css'

const FILTERS = ['none', 'warm', 'cool', 'vintage', 'fade', 'dark', 'gold']
const TIMERS = ['off', '3s', '10s']
const ZOOMS = ['1x', '2x', '5x']
const MODE_TABS = ['camera', 'video']
const MODE_LABELS = {
  camera: 'PHOTO',
  video: 'VIDEO',
}
const SNAP_CAPTURE_WIDTH = 1080
const SNAP_CAPTURE_HEIGHT = 1920
const SNAP_CAPTURE_FPS = 30
const SVG_PREVIEW_WIDTH = 1000
const SVG_PREVIEW_HEIGHT = Math.round((SVG_PREVIEW_WIDTH * 16) / 9)
const OVERLAY_STROKE_COLOR = 'rgba(255,255,255,0.96)'
const OVERLAY_SHADOW_COLOR = 'rgba(0,0,0,0.45)'

function createOverlayId() {
  return `overlay_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function parseZoomFactor(zoomValue) {
  const normalized = String(zoomValue || '1x').trim().toLowerCase()
  const parsed = Number.parseFloat(normalized.replace('x', ''))
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1
}

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

function drawSourceToCanvas({
  sourceElement,
  sourceWidth,
  sourceHeight,
  targetCanvas,
  mirror = false,
  zoomFactor = 1,
}) {
  if (!sourceWidth || !sourceHeight || !targetCanvas || !sourceElement) return false

  const context = targetCanvas.getContext('2d')
  if (!context) return false

  const baseCrop = getNineBySixteenCrop(sourceWidth, sourceHeight)
  const safeZoomFactor = Math.max(1, Number(zoomFactor || 1))
  const zoomedWidth = baseCrop.sw / safeZoomFactor
  const zoomedHeight = baseCrop.sh / safeZoomFactor
  const sx = baseCrop.sx + ((baseCrop.sw - zoomedWidth) / 2)
  const sy = baseCrop.sy + ((baseCrop.sh - zoomedHeight) / 2)
  const sw = zoomedWidth
  const sh = zoomedHeight
  context.save()
  context.clearRect(0, 0, targetCanvas.width, targetCanvas.height)
  if (mirror) {
    context.translate(targetCanvas.width, 0)
    context.scale(-1, 1)
  }
  context.drawImage(
    sourceElement,
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

function drawVideoFrameToCanvas({ sourceVideo, targetCanvas, mirror = false, zoomFactor = 1 }) {
  const sourceWidth = Number(sourceVideo?.videoWidth || 0)
  const sourceHeight = Number(sourceVideo?.videoHeight || 0)
  return drawSourceToCanvas({
    sourceElement: sourceVideo,
    sourceWidth,
    sourceHeight,
    targetCanvas,
    mirror,
    zoomFactor,
  })
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

function buildOverlayItem(type, content, existingCount) {
  const boundedCount = Math.max(0, Number(existingCount || 0))
  const offsetIndex = boundedCount % 4
  return {
    id: createOverlayId(),
    type,
    content,
    x: 0.5,
    y: clamp(0.24 + (offsetIndex * 0.12), 0.18, 0.82),
  }
}

function pathToSvg(points) {
  if (!Array.isArray(points) || points.length === 0) return ''
  return points.map((point, index) => {
    const x = clamp(Number(point?.x || 0), 0, 1) * SVG_PREVIEW_WIDTH
    const y = clamp(Number(point?.y || 0), 0, 1) * SVG_PREVIEW_HEIGHT
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
  }).join(' ')
}

function loadImageElement(objectUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('overlay-image-load-failed'))
    image.src = objectUrl
  })
}

function canvasToBlob(targetCanvas, type, quality) {
  return new Promise((resolve, reject) => {
    targetCanvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
      } else {
        reject(new Error('overlay-canvas-export-failed'))
      }
    }, type, quality)
  })
}

function isLikelyMobileDevice() {
  if (typeof window === 'undefined') return false
  const coarsePointer = typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches
  const userAgent = typeof navigator !== 'undefined'
    ? String(navigator.userAgent || '')
    : ''
  return coarsePointer || /android|iphone|ipad|ipod|mobile/i.test(userAgent)
}

function getImageExtensionFromMimeType(mimeType) {
  const normalizedType = String(mimeType || '').trim().toLowerCase()
  if (normalizedType.includes('png')) return 'png'
  if (normalizedType.includes('webp')) return 'webp'
  if (normalizedType.includes('gif')) return 'gif'
  if (normalizedType.includes('heic')) return 'heic'
  if (normalizedType.includes('heif')) return 'heif'
  if (normalizedType.includes('bmp')) return 'bmp'
  return 'jpg'
}

async function createImageFileFromUrlCandidates(urlCandidates, fallbackPrefix = 'snap') {
  const uniqueCandidates = [...new Set(
    (urlCandidates || [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  )]

  for (const candidate of uniqueCandidates) {
    try {
      const response = await fetch(candidate)
      if (!response.ok) continue
      const blob = await response.blob()
      const mimeType = String(blob.type || '').trim() || 'image/jpeg'
      const extension = getImageExtensionFromMimeType(mimeType)
      return new File([blob], `${fallbackPrefix}_${Date.now()}.${extension}`, {
        type: mimeType,
        lastModified: Date.now(),
      })
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error('snap-library-photo-read-failed')
}

function isCancellationError(error) {
  const message = String(error?.message || error || '').trim().toLowerCase()
  return message.includes('cancel')
}

export default function SnapCameraScreen({ currentUser, otherUser, onClose, onSend }) {
  const [mode, setMode] = useState('camera')
  const [filter, setFilter] = useState('none')
  const [timer, setTimer] = useState('off')
  const [zoom, setZoom] = useState('1x')
  const [flash, setFlash] = useState(false)
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [frontCam, setFront] = useState(false)
  const [preview, setPreview] = useState(null)
  const [file, setFile] = useState(null)
  const [capturedType, setCapturedType] = useState('photo')
  const [overlayItems, setOverlayItems] = useState([])
  const [drawingPaths, setDrawingPaths] = useState([])
  const [draftDrawingPath, setDraftDrawingPath] = useState(null)
  const [isDrawMode, setIsDrawMode] = useState(false)
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
  const stageRef = useRef(null)
  const dragOverlayRef = useRef(null)
  const drawingPathRef = useRef(null)
  const zoomFactor = parseZoomFactor(zoom)
  const isMobileDevice = isLikelyMobileDevice()
  const isNativeRuntime = Capacitor.isNativePlatform()
  const cameraToggleLabel = isMobileDevice ? 'Rotate Camera' : 'Flip'
  const libraryAccept = mode === 'video' ? 'video/*' : 'image/*'

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

  function clearOverlayEditing() {
    setOverlayItems([])
    setDrawingPaths([])
    setDraftDrawingPath(null)
    drawingPathRef.current = null
    setIsDrawMode(false)
  }

  function getAllDrawingPaths() {
    return draftDrawingPath?.points?.length
      ? [...drawingPaths, draftDrawingPath]
      : drawingPaths
  }

  function drawOverlayItemsToCanvas(context, width, height, overlaySnapshot) {
    if (!context || !Array.isArray(overlaySnapshot)) return

    overlaySnapshot.forEach((item) => {
      const x = clamp(Number(item?.x || 0.5), 0, 1) * width
      const y = clamp(Number(item?.y || 0.5), 0, 1) * height
      const content = String(item?.content || '').trim()
      if (!content) return

      context.save()
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.shadowColor = OVERLAY_SHADOW_COLOR
      context.shadowBlur = Math.round(width * 0.012)
      context.shadowOffsetY = Math.round(height * 0.005)

      if (item.type === 'emoji') {
        context.font = `900 ${Math.round(width * 0.09)}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`
        context.fillText(content, x, y)
        context.restore()
        return
      }

      if (item.type === 'note') {
        context.font = `800 ${Math.round(width * 0.036)}px "Segoe UI", sans-serif`
        const maxWidth = width * 0.58
        const words = content.split(/\s+/).filter(Boolean)
        const lines = []
        let currentLine = ''
        words.forEach((word) => {
          const nextLine = currentLine ? `${currentLine} ${word}` : word
          if (context.measureText(nextLine).width > maxWidth && currentLine) {
            lines.push(currentLine)
            currentLine = word
          } else {
            currentLine = nextLine
          }
        })
        if (currentLine) lines.push(currentLine)
        if (lines.length === 0) lines.push(content)

        const lineHeight = Math.round(width * 0.05)
        const boxWidth = Math.min(
          maxWidth + Math.round(width * 0.12),
          Math.max(
            ...lines.map((line) => context.measureText(line).width + Math.round(width * 0.12)),
          ),
        )
        const boxHeight = (lines.length * lineHeight) + Math.round(height * 0.06)
        const boxX = x - (boxWidth / 2)
        const boxY = y - (boxHeight / 2)
        const radius = Math.round(width * 0.03)

        context.shadowBlur = Math.round(width * 0.02)
        context.shadowOffsetY = Math.round(height * 0.008)
        context.fillStyle = 'rgba(255, 240, 112, 0.94)'
        context.beginPath()
        context.moveTo(boxX + radius, boxY)
        context.lineTo(boxX + boxWidth - radius, boxY)
        context.quadraticCurveTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + radius)
        context.lineTo(boxX + boxWidth, boxY + boxHeight - radius)
        context.quadraticCurveTo(boxX + boxWidth, boxY + boxHeight, boxX + boxWidth - radius, boxY + boxHeight)
        context.lineTo(boxX + radius, boxY + boxHeight)
        context.quadraticCurveTo(boxX, boxY + boxHeight, boxX, boxY + boxHeight - radius)
        context.lineTo(boxX, boxY + radius)
        context.quadraticCurveTo(boxX, boxY, boxX + radius, boxY)
        context.closePath()
        context.fill()

        context.shadowColor = 'transparent'
        context.fillStyle = '#1d1d1d'
        lines.forEach((line, index) => {
          const lineY = boxY + Math.round(height * 0.032) + (index * lineHeight) + (lineHeight / 2)
          context.fillText(line, x, lineY)
        })
        context.restore()
        return
      }

      context.font = `900 ${Math.round(width * 0.062)}px "Segoe UI", sans-serif`
      context.fillStyle = '#ffffff'
      context.strokeStyle = 'rgba(0, 0, 0, 0.35)'
      context.lineWidth = Math.max(4, Math.round(width * 0.01))
      context.lineJoin = 'round'
      context.miterLimit = 2
      context.strokeText(content, x, y)
      context.fillText(content, x, y)
      context.restore()
    })
  }

  function drawPathsToCanvas(context, width, height, pathSnapshot) {
    if (!context || !Array.isArray(pathSnapshot)) return

    pathSnapshot.forEach((path) => {
      const points = Array.isArray(path?.points) ? path.points : []
      if (points.length === 0) return
      context.save()
      context.beginPath()
      context.strokeStyle = path.color || OVERLAY_STROKE_COLOR
      context.lineWidth = Math.max(6, Math.round(width * 0.008))
      context.lineCap = 'round'
      context.lineJoin = 'round'
      points.forEach((point, index) => {
        const x = clamp(Number(point?.x || 0), 0, 1) * width
        const y = clamp(Number(point?.y || 0), 0, 1) * height
        if (index === 0) {
          context.moveTo(x, y)
        } else {
          context.lineTo(x, y)
        }
      })
      context.stroke()
      context.restore()
    })
  }

  function drawAllOverlaysToCanvas(targetCanvas, overlaySnapshot, pathSnapshot) {
    const context = targetCanvas.getContext('2d')
    if (!context) return false
    drawPathsToCanvas(context, targetCanvas.width, targetCanvas.height, pathSnapshot)
    drawOverlayItemsToCanvas(context, targetCanvas.width, targetCanvas.height, overlaySnapshot)
    return true
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
      zoomFactor,
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

  async function applyTorchState(nextEnabled) {
    const videoTrack = streamRef.current?.getVideoTracks?.()?.[0]
    if (!videoTrack || typeof videoTrack.getCapabilities !== 'function' || typeof videoTrack.applyConstraints !== 'function') {
      if (mountedRef.current) {
        setTorchAvailable(false)
      }
      return false
    }

    try {
      const capabilities = videoTrack.getCapabilities()
      const supportsTorch = Boolean(capabilities?.torch)
      if (mountedRef.current) {
        setTorchAvailable(supportsTorch && !frontCam)
      }
      if (!supportsTorch || frontCam) {
        if (supportsTorch) {
          try {
            await videoTrack.applyConstraints({
              advanced: [{ torch: false }],
            })
          } catch {
            // Ignore best-effort torch shutdown issues.
          }
        }
        return false
      }

      await videoTrack.applyConstraints({
        advanced: [{ torch: Boolean(nextEnabled) }],
      })
      return true
    } catch {
      if (mountedRef.current) {
        setTorchAvailable(false)
      }
      return false
    }
  }

  async function applyNativeTrackZoom(nextZoomFactor) {
    const videoTrack = streamRef.current?.getVideoTracks?.()?.[0]
    if (!videoTrack || typeof videoTrack.getCapabilities !== 'function' || typeof videoTrack.applyConstraints !== 'function') {
      return
    }

    try {
      const capabilities = videoTrack.getCapabilities()
      const zoomCapabilities = capabilities?.zoom
      if (!zoomCapabilities) return

      const minZoom = Number(zoomCapabilities.min || 1) || 1
      const maxZoom = Number(zoomCapabilities.max || nextZoomFactor) || nextZoomFactor
      if (minZoom > 1.05) {
        return
      }

      const step = Number(zoomCapabilities.step || 0) || 0
      let resolvedZoom = nextZoomFactor <= 1.01
        ? 1
        : clamp(nextZoomFactor, Math.max(1, minZoom), maxZoom)
      if (step > 0) {
        resolvedZoom = Math.round(resolvedZoom / step) * step
      }

      await videoTrack.applyConstraints({
        advanced: [{ zoom: resolvedZoom }],
      })
    } catch {
      // Ignore unsupported camera zoom failures and rely on digital zoom fallback.
    }
  }

  function stopPreview() {
    stopCaptureComposition()
    void applyTorchState(false)
    if (mountedRef.current) {
      setTorchAvailable(false)
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    streamRef.current?.getTracks?.().forEach((track) => track.stop())
    streamRef.current = null
  }

  function clearCapturedMedia(options = {}) {
    const { restartPreview = true } = options
    replacePreviewUrl(null)
    setFile(null)
    setCapturedType('photo')
    setSent(false)
    clearOverlayEditing()
    if (restartPreview && mountedRef.current) {
      void startPreview()
    }
  }

  async function startPreview() {
    try {
      stopPreview()
      const buildConstraints = (withAudio) => ({
        video: {
          facingMode: frontCam ? 'user' : 'environment',
          width: { ideal: SNAP_CAPTURE_WIDTH },
          height: { ideal: SNAP_CAPTURE_HEIGHT },
          aspectRatio: { ideal: SNAP_CAPTURE_WIDTH / SNAP_CAPTURE_HEIGHT },
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
      await applyNativeTrackZoom(zoomFactor)
      await applyTorchState(flash)
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
    stopPreview()
    clearCapturedMedia({ restartPreview: false })
    setFile(inputFile)
    setCapturedType('photo')
    replacePreviewUrl(URL.createObjectURL(inputFile))
  }

  function acceptCapturedVideo(inputFile) {
    if (!inputFile) return
    const preparedFile = buildVideoFile(inputFile, inputFile.name, inputFile.type)
    stopPreview()
    clearCapturedMedia({ restartPreview: false })
    setFile(preparedFile)
    setCapturedType('video')
    replacePreviewUrl(URL.createObjectURL(preparedFile))
  }

  function addOverlayItem(type, content) {
    const normalizedContent = String(content || '').trim()
    if (!normalizedContent) return
    setOverlayItems((prev) => [...prev, buildOverlayItem(type, normalizedContent, prev.length)])
  }

  function promptForOverlay(type) {
    const promptCopy = (
      type === 'emoji'
        ? 'Add an emoji'
        : type === 'note'
          ? 'Add a note'
          : 'Add text'
    )
    const defaultValue = (
      type === 'emoji'
        ? '🙂'
        : type === 'note'
          ? 'Quick note'
          : 'Your text'
    )
    const response = window.prompt(promptCopy, defaultValue)
    if (!response) return
    addOverlayItem(type, response)
  }

  function getStagePoint(event) {
    const rect = stageRef.current?.getBoundingClientRect?.()
    if (!rect) return null
    const clientX = Number(event?.clientX || 0)
    const clientY = Number(event?.clientY || 0)
    return {
      x: clamp((clientX - rect.left) / Math.max(rect.width, 1), 0, 1),
      y: clamp((clientY - rect.top) / Math.max(rect.height, 1), 0, 1),
    }
  }

  function stopOverlayDrag() {
    dragOverlayRef.current = null
    window.removeEventListener('pointermove', handleOverlayDragMove)
    window.removeEventListener('pointerup', stopOverlayDrag)
    window.removeEventListener('pointercancel', stopOverlayDrag)
  }

  function handleOverlayDragMove(event) {
    if (!dragOverlayRef.current) return
    const stagePoint = getStagePoint(event)
    if (!stagePoint) return

    const { id, offsetX, offsetY } = dragOverlayRef.current
    setOverlayItems((prev) => prev.map((item) => (
      item.id === id
        ? {
            ...item,
            x: clamp(stagePoint.x - offsetX, 0.08, 0.92),
            y: clamp(stagePoint.y - offsetY, 0.08, 0.92),
          }
        : item
    )))
  }

  function handleOverlayPointerDown(event, item) {
    if (!item) return
    event.preventDefault()
    event.stopPropagation()
    const stagePoint = getStagePoint(event)
    if (!stagePoint) return

    dragOverlayRef.current = {
      id: item.id,
      offsetX: stagePoint.x - item.x,
      offsetY: stagePoint.y - item.y,
    }

    window.addEventListener('pointermove', handleOverlayDragMove)
    window.addEventListener('pointerup', stopOverlayDrag)
    window.addEventListener('pointercancel', stopOverlayDrag)
  }

  function handleOverlayDoubleClick(itemId) {
    setOverlayItems((prev) => prev.filter((item) => item.id !== itemId))
  }

  function handleDrawButtonPress() {
    setIsDrawMode((prev) => !prev)
    setDraftDrawingPath(null)
    drawingPathRef.current = null
  }

  function handleDrawingPointerDown(event) {
    if (!isDrawMode) return
    event.preventDefault()
    const stagePoint = getStagePoint(event)
    if (!stagePoint) return
    const nextPath = {
      id: createOverlayId(),
      color: OVERLAY_STROKE_COLOR,
      points: [stagePoint],
    }
    drawingPathRef.current = nextPath
    setDraftDrawingPath(nextPath)
  }

  function handleDrawingPointerMove(event) {
    if (!isDrawMode || !drawingPathRef.current) return
    event.preventDefault()
    const stagePoint = getStagePoint(event)
    if (!stagePoint) return
    const updatedPath = {
      ...drawingPathRef.current,
      points: [...drawingPathRef.current.points, stagePoint],
    }
    drawingPathRef.current = updatedPath
    setDraftDrawingPath(updatedPath)
  }

  function handleDrawingPointerUp() {
    if (!isDrawMode || !drawingPathRef.current) return
    const completedPath = drawingPathRef.current
    drawingPathRef.current = null
    setDraftDrawingPath(null)
    if ((completedPath.points || []).length > 1) {
      setDrawingPaths((prev) => [...prev, completedPath])
    }
  }

  async function composeImageWithOverlays(inputFile, overlaySnapshot, pathSnapshot) {
    const sourceUrl = URL.createObjectURL(inputFile)
    try {
      const image = await loadImageElement(sourceUrl)
      const canvas = document.createElement('canvas')
      canvas.width = SNAP_CAPTURE_WIDTH
      canvas.height = SNAP_CAPTURE_HEIGHT
      drawSourceToCanvas({
        sourceElement: image,
        sourceWidth: image.naturalWidth || image.width,
        sourceHeight: image.naturalHeight || image.height,
        targetCanvas: canvas,
      })
      drawAllOverlaysToCanvas(canvas, overlaySnapshot, pathSnapshot)
      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92)
      const outputName = `${String(inputFile?.name || 'snap').replace(/\.[^.]+$/, '') || 'snap'}.jpg`
      return new File([blob], outputName, {
        type: 'image/jpeg',
        lastModified: Date.now(),
      })
    } finally {
      URL.revokeObjectURL(sourceUrl)
    }
  }

  async function composeVideoWithOverlays(inputFile, overlaySnapshot, pathSnapshot) {
    const sourceUrl = URL.createObjectURL(inputFile)
    const video = document.createElement('video')
    video.preload = 'auto'
    video.playsInline = true
    video.setAttribute('playsinline', '')
    video.volume = 0
    video.src = sourceUrl

    const attachedToBody = typeof document !== 'undefined' && !!document.body
    if (attachedToBody) {
      video.style.position = 'fixed'
      video.style.left = '-99999px'
      video.style.top = '0'
      video.style.width = '1px'
      video.style.height = '1px'
      video.style.opacity = '0'
      video.style.pointerEvents = 'none'
      document.body.appendChild(video)
    }

    try {
      const loaded = await new Promise((resolve, reject) => {
        if (video.readyState >= 2) {
          resolve(true)
          return
        }

        const handleReady = () => {
          cleanup()
          resolve(true)
        }
        const handleError = () => {
          cleanup()
          reject(new Error('overlay-video-load-failed'))
        }
        const cleanup = () => {
          video.removeEventListener('loadeddata', handleReady)
          video.removeEventListener('canplay', handleReady)
          video.removeEventListener('error', handleError)
        }

        video.addEventListener('loadeddata', handleReady, { once: true })
        video.addEventListener('canplay', handleReady, { once: true })
        video.addEventListener('error', handleError, { once: true })
      })
      if (!loaded) {
        return inputFile
      }

      const outputCanvas = document.createElement('canvas')
      outputCanvas.width = SNAP_CAPTURE_WIDTH
      outputCanvas.height = SNAP_CAPTURE_HEIGHT

      const mediaStream = typeof video.captureStream === 'function'
        ? video.captureStream()
        : null
      const outputStream = outputCanvas.captureStream(SNAP_CAPTURE_FPS)
      mediaStream?.getAudioTracks?.().forEach((track) => outputStream.addTrack(track))

      const preferredMimeTypes = [
        'video/mp4;codecs=h264,aac',
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ]
      const supportedMimeType = preferredMimeTypes.find((value) => MediaRecorder.isTypeSupported?.(value))
      const recorder = supportedMimeType
        ? new MediaRecorder(outputStream, { mimeType: supportedMimeType })
        : new MediaRecorder(outputStream)
      const chunks = []
      let animationFrameId = 0
      let videoFrameCallbackId = 0
      let playbackStopped = false

      const renderFrame = () => {
        const didDraw = drawSourceToCanvas({
          sourceElement: video,
          sourceWidth: video.videoWidth,
          sourceHeight: video.videoHeight,
          targetCanvas: outputCanvas,
        })
        if (didDraw) {
          drawAllOverlaysToCanvas(outputCanvas, overlaySnapshot, pathSnapshot)
        }
      }

      const scheduleNextFrame = () => {
        if (playbackStopped || video.ended || recorder.state === 'inactive') {
          return
        }

        if (typeof video.requestVideoFrameCallback === 'function') {
          videoFrameCallbackId = video.requestVideoFrameCallback(() => {
            renderFrame()
            scheduleNextFrame()
          })
          return
        }

        animationFrameId = window.requestAnimationFrame(() => {
          renderFrame()
          scheduleNextFrame()
        })
      }

      const stopStreams = () => {
        playbackStopped = true
        if (animationFrameId) {
          window.cancelAnimationFrame(animationFrameId)
          animationFrameId = 0
        }
        if (videoFrameCallbackId && typeof video.cancelVideoFrameCallback === 'function') {
          video.cancelVideoFrameCallback(videoFrameCallbackId)
          videoFrameCallbackId = 0
        }
        outputStream.getTracks().forEach((track) => track.stop())
        mediaStream?.getTracks?.().forEach((track) => track.stop())
        video.pause()
        video.removeAttribute('src')
        video.load()
      }

      const blob = await new Promise(async (resolve, reject) => {
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            chunks.push(event.data)
          }
        }
        recorder.onerror = (event) => {
          stopStreams()
          reject(event)
        }
        recorder.onstop = () => {
          stopStreams()
          resolve(new Blob(chunks, { type: recorder.mimeType || inputFile.type || 'video/mp4' }))
        }

        try {
          await video.play()
        } catch {
          video.muted = true
          video.defaultMuted = true
          video.setAttribute('muted', '')
          await video.play()
        }

        renderFrame()
        recorder.start(250)
        scheduleNextFrame()
        video.onended = () => {
          if (recorder.state !== 'inactive') {
            recorder.stop()
          }
        }
      })

      return buildVideoFile(blob, inputFile?.name || `snap_${Date.now()}`, recorder.mimeType || blob.type || inputFile.type)
    } finally {
      if (attachedToBody) {
        video.remove()
      }
      URL.revokeObjectURL(sourceUrl)
    }
  }

  async function prepareMediaForSend(inputFile, mediaType) {
    const overlaySnapshot = overlayItems.map((item) => ({ ...item }))
    const pathSnapshot = getAllDrawingPaths().map((path) => ({
      ...path,
      points: Array.isArray(path.points) ? path.points.map((point) => ({ ...point })) : [],
    }))

    if (overlaySnapshot.length === 0 && pathSnapshot.length === 0) {
      return inputFile
    }

    if (mediaType === 'video') {
      return composeVideoWithOverlays(inputFile, overlaySnapshot, pathSnapshot)
    }

    return composeImageWithOverlays(inputFile, overlaySnapshot, pathSnapshot)
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

  async function handleLibraryButtonPress() {
    if (mode !== 'video' && isNativeRuntime) {
      try {
        const photo = await Camera.getPhoto({
          source: CameraSource.Photos,
          resultType: CameraResultType.Uri,
          quality: 92,
          correctOrientation: true,
        })

        const nativePath = String(photo?.path || '').trim()
        const webPath = String(photo?.webPath || '').trim()
        const urlCandidates = [
          webPath,
          nativePath && typeof Capacitor.convertFileSrc === 'function'
            ? Capacitor.convertFileSrc(nativePath)
            : '',
        ]
        const selectedPhoto = await createImageFileFromUrlCandidates(urlCandidates, 'snap')
        acceptCapturedPhoto(selectedPhoto)
      } catch (error) {
        if (!isCancellationError(error)) {
          console.error('Snap library open failed:', error)
        }
      }
      return
    }

    const input = libraryInputRef.current
    if (!input) return
    input.value = ''
    try {
      if (typeof input.showPicker === 'function') {
        input.showPicker()
        return
      }
    } catch {
      // Fall through to click for runtimes without showPicker support.
    }
    input.click()
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
      const preparedFile = await prepareMediaForSend(file, capturedType)
      const didSend = await onSend(preparedFile, capturedType)
      if (!didSend) {
        return
      }

      setSent(true)
      window.setTimeout(() => {
        setSent(false)
        clearCapturedMedia({ restartPreview: false })
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
      stopOverlayDrag()
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

  useEffect(() => {
    if (frontCam && flash) {
      setFlash(false)
    }
  }, [flash, frontCam])

  useEffect(() => {
    void applyNativeTrackZoom(zoomFactor)
    renderCaptureFrame()
  }, [zoomFactor])

  useEffect(() => {
    if (preview) return
    void applyTorchState(flash)
  }, [flash, frontCam, preview])

  const previewImageClassName = filter !== 'none' ? `filter-${filter}` : ''
  const previewTransform = `${frontCam ? 'scaleX(-1) ' : ''}scale(${zoomFactor})`

  return (
    <div className="snap-screen">
      <div className="snap-stage" ref={stageRef}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`snap-video ${previewImageClassName}`}
          style={{ transform: previewTransform }}
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

            <div className="snap-overlay-layer">
              <svg
                className={`snap-drawing-overlay ${isDrawMode ? 'is-drawing' : ''}`}
                viewBox={`0 0 ${SVG_PREVIEW_WIDTH} ${SVG_PREVIEW_HEIGHT}`}
                preserveAspectRatio="none"
                onPointerDown={handleDrawingPointerDown}
                onPointerMove={handleDrawingPointerMove}
                onPointerUp={handleDrawingPointerUp}
                onPointerCancel={handleDrawingPointerUp}
                onPointerLeave={handleDrawingPointerUp}
              >
                {getAllDrawingPaths().map((path) => (
                  <path
                    key={path.id}
                    d={pathToSvg(path.points)}
                    fill="none"
                    stroke={path.color || OVERLAY_STROKE_COLOR}
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
              </svg>

              {overlayItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`snap-overlay-item snap-overlay-item-${item.type}`}
                  style={{
                    left: `${clamp(Number(item.x || 0.5), 0, 1) * 100}%`,
                    top: `${clamp(Number(item.y || 0.5), 0, 1) * 100}%`,
                  }}
                  onPointerDown={(event) => handleOverlayPointerDown(event, item)}
                  onDoubleClick={() => handleOverlayDoubleClick(item.id)}
                >
                  {item.content}
                </button>
              ))}
            </div>

            <button className="send-btn" onClick={sendSnap} disabled={sending} type="button">
              {sending ? 'Sending' : 'Send'}
            </button>

            <button className="discard-btn" onClick={clearCapturedMedia} type="button">
              Back
            </button>

            <div className="edit-tools">
              <button type="button" onClick={() => promptForOverlay('text')}>Text</button>
              <button
                type="button"
                className={isDrawMode ? 'is-active' : ''}
                onClick={handleDrawButtonPress}
              >
                {isDrawMode ? 'Drawing' : 'Draw'}
              </button>
              <button type="button" onClick={() => promptForOverlay('emoji')}>Emoji</button>
              <button type="button" onClick={() => promptForOverlay('note')}>Note</button>
            </div>

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
              disabled={frontCam || (!torchAvailable && !flash)}
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
              <button
                className="flip-btn"
                onClick={() => setFront(!frontCam)}
                disabled={isRecording}
                type="button"
              >
                {cameraToggleLabel}
              </button>
            </div>
          </div>
        </>
      )}

      <input
        ref={libraryInputRef}
        type="file"
        accept={libraryAccept}
        style={{
          position: 'fixed',
          left: '-9999px',
          top: '0',
          width: '1px',
          height: '1px',
          opacity: 0,
          pointerEvents: 'none',
        }}
        onChange={handleLibraryInputChange}
      />
    </div>
  )
}
