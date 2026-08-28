import { nativeImage, type NativeImage } from 'electron'

// A small blue magnifying-glass glyph (32x32, transparent background) drawn
// once via <canvas> and embedded here so the tray icon doesn't depend on any
// bundled asset file or network fetch. Matches the app's accent color
// (#5b8def). Regenerate by drawing the same shape on a canvas and taking
// canvas.toDataURL('image/png').
const TRAY_ICON_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAACm0lEQVR4AeyW33HTQBDGP9lpQB3IlWB3wRBmsEuADM+xn5lACXJmCEMXgUqkDtRAbPF94s6jlU7SGTB5iUanvbtd7f5u7480wzNfLwDRGXj9pcre3FW3Ktefq8fruypnff32U7X8m1mcBFAABivmRxQJsFVBjSWANet5PYNgCtnhD65BAI1YI1UA+s1Yxu5MdgTNx4xCuiCAgs9r5Pg90tB7Q31rQhRDylB/EGAgeFkDm4ebNFE5zLBQGwl+wF4ZIaIz0QPQwuqOPDlixaCLbzfp3sf6/j4t1X74kK4IsvX9TkYvzh5AkuCdc9IIBf/6Me2OstH5B0F2XYh6jluvH5MGoDd6pncquHd+nOEetPdt1FjG7AwDcHrZVeoa9646KTQl59h7hwaA+/qVV0hyVKOpl027zI4o0br4vvHXUp2qBuDU6yoalatGiacrGAAOaOr8gAHgQjIOdB7gjOvqCSYg/f3ExGUAurZdh119t82UG4CuPtQ2AJxDQ8zjNfpAkXOm3Gw9Ak2uIQPQbLn2VgKaL6CcTxVuYQVvZ2Afs4YMgIIkB+wkfeGo1s657+pJ6WlnTkMe1cZP7yXX0QNosgCcjlwwC3LO871QIB0uWpySarO/lp527buMXT89AHlp6O1UqDtTIK6LR/0bSKotRaBk1OeCDOhMVxBAc3dIsOE2Mmk1b4Yb7W0cBREEkG9B6CPDbCzYbk8Jm/YWqOxYVlaDSYhBAO9IIPwUb+h8wUDKisqW9a2+lNQlApWdiuz8u05mY9MxCeCcQM4ZaO/KjnLnFqw3aaTszoGIBmi8Rz7OgbgIgDhjIS4GMAUhvcpFARRgKBP+jLg4wABE6RfwfwFoQ3D76tdeZ4u67Q9J0/OPH213mg5uX3Oo/QIAAP//OrS8xAAAAAZJREFUAwCcvCJQQWkl0gAAAABJRU5ErkJggg=='

export function createTrayIcon(): NativeImage {
  return nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON_BASE64}`)
}
