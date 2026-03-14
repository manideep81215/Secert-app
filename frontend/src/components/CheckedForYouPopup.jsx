import { motion, AnimatePresence } from 'framer-motion'

function CheckedForYouPopup({ checkerUsername, checkCount, onDismiss }) {
  if (!checkerUsername || !checkCount) return null

  return (
    <AnimatePresence>
      <motion.button
        type="button"
        className="checked-popup"
        initial={{ opacity: 0, y: 18, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        onClick={onDismiss}
      >
        <span className="checked-popup-eye" aria-hidden="true">👀</span>
        <span className="checked-popup-copy">
          <strong>@{checkerUsername}</strong> checked for you{' '}
          <strong>{checkCount} {checkCount === 1 ? 'time' : 'times'}</strong>
        </span>
        <span className="checked-popup-hint">tap to dismiss</span>
      </motion.button>
    </AnimatePresence>
  )
}

export default CheckedForYouPopup
