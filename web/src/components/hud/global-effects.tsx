// CRT raster and vignette. Both fixed, both pointer-events:none, so they
// sit over the whole interface without ever eating a click. Neither
// animates - the spec budgets three infinite animations and these would
// be a poor use of two of them.
export function GlobalEffects() {
  return (
    <>
      <div className="vignette" aria-hidden />
      <div className="scanlines" aria-hidden />
    </>
  )
}
