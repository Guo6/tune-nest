// Small byte-mode QR encoder for the short, ASCII-only NetEase login URL.
// Version 4-L holds up to 78 bytes (the login URL is about 73 bytes).
const SIZE = 33
const DATA_CODEWORDS = 80
const ECC_CODEWORDS = 20

function gfMultiply(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z
}

function reedSolomon(data: number[]): number[] {
  let divisor = [1]
  let root = 1
  for (let i = 0; i < ECC_CODEWORDS; i++) {
    const next = Array(divisor.length + 1).fill(0)
    divisor.forEach((coefficient, j) => {
      next[j] ^= coefficient
      next[j + 1] ^= gfMultiply(coefficient, root)
    })
    divisor = next
    root = gfMultiply(root, 2)
  }
  const remainder = [...data, ...Array(ECC_CODEWORDS).fill(0)]
  for (let i = 0; i < data.length; i++) {
    const factor = remainder[i]
    if (factor) divisor.forEach((coefficient, j) => { remainder[i + j] ^= gfMultiply(coefficient, factor) })
  }
  return remainder.slice(data.length)
}

function makeCodewords(text: string): number[] {
  const bytes = Array.from(new TextEncoder().encode(text))
  if (bytes.length > 78) throw new Error('登录二维码内容超长')
  const bits: number[] = []
  const append = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1)
  }
  append(0b0100, 4) // byte mode
  append(bytes.length, 8)
  bytes.forEach((byte) => append(byte, 8))
  for (let i = 0; i < Math.min(4, DATA_CODEWORDS * 8 - bits.length); i++) bits.push(0)
  while (bits.length % 8) bits.push(0)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    data.push(bits.slice(i, i + 8).reduce((value, bit) => (value << 1) | bit, 0))
  }
  for (let pad = 0; data.length < DATA_CODEWORDS; pad++) data.push(pad % 2 ? 0x11 : 0xec)
  return [...data, ...reedSolomon(data)]
}

function makeMatrix(text: string): boolean[][] {
  const modules = Array.from({ length: SIZE }, () => Array<boolean>(SIZE).fill(false))
  const functionModule = Array.from({ length: SIZE }, () => Array<boolean>(SIZE).fill(false))
  const setFunction = (x: number, y: number, value: boolean) => {
    if (x >= 0 && y >= 0 && x < SIZE && y < SIZE) {
      modules[y][x] = value
      functionModule[y][x] = true
    }
  }

  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const distance = Math.max(Math.abs(dx), Math.abs(dy))
      setFunction(cx + dx, cy + dy, distance !== 2 && distance <= 3)
    }
  }
  finder(3, 3)
  finder(SIZE - 4, 3)
  finder(3, SIZE - 4)

  // Version 4 alignment pattern positions; skip centers already occupied by finders.
  for (const [cx, cy] of [[26, 6], [6, 26], [26, 26]]) {
    if (functionModule[cy][cx]) continue // overlaps one of the three finder patterns
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }
  }
  for (let i = 8; i < SIZE - 8; i++) {
    if (!functionModule[6][i]) setFunction(i, 6, i % 2 === 0)
    if (!functionModule[i][6]) setFunction(6, i, i % 2 === 0)
  }
  // Reserve the format-information cells and fixed dark module before placing data.
  for (let i = 0; i <= 5; i++) setFunction(8, i, false)
  setFunction(8, 7, false)
  setFunction(8, 8, false)
  setFunction(7, 8, false)
  for (let i = 9; i < 15; i++) setFunction(14 - i, 8, false)
  for (let i = 0; i < 8; i++) setFunction(SIZE - 1 - i, 8, false)
  for (let i = 8; i < 15; i++) setFunction(8, SIZE - 15 + i, false)
  setFunction(8, SIZE - 8, true)

  const codewords = makeCodewords(text)
  const bits = codewords.flatMap((word) => Array.from({ length: 8 }, (_, i) => (word >>> (7 - i)) & 1))
  let bitIndex = 0
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right--
    const upward = ((right + 1) & 2) === 0
    for (let vert = 0; vert < SIZE; vert++) {
      const y = upward ? SIZE - 1 - vert : vert
      for (let offset = 0; offset < 2; offset++) {
        const x = right - offset
        if (functionModule[y][x]) continue
        const bit = bitIndex < bits.length ? bits[bitIndex++] === 1 : false
        modules[y][x] = bit !== ((x + y) % 2 === 0) // mask pattern 0
      }
    }
  }

  // Error correction level L, mask pattern 0.
  const formatData = 0b01000
  let remainder = formatData << 10
  for (let bit = 14; bit >= 10; bit--) if ((remainder >>> bit) & 1) remainder ^= 0x537 << (bit - 10)
  const format = ((formatData << 10) | remainder) ^ 0x5412
  const formatBit = (i: number) => ((format >>> i) & 1) !== 0
  for (let i = 0; i <= 5; i++) setFunction(8, i, formatBit(i))
  setFunction(8, 7, formatBit(6))
  setFunction(8, 8, formatBit(7))
  setFunction(7, 8, formatBit(8))
  for (let i = 9; i < 15; i++) setFunction(14 - i, 8, formatBit(i))
  for (let i = 0; i < 8; i++) setFunction(SIZE - 1 - i, 8, formatBit(i))
  for (let i = 8; i < 15; i++) setFunction(8, SIZE - 15 + i, formatBit(i))
  setFunction(8, SIZE - 8, true)
  return modules
}

export function makeQrDataUrl(text: string): string {
  const matrix = makeMatrix(text)
  const quiet = 4
  const paths: string[] = []
  matrix.forEach((row, y) => row.forEach((dark, x) => {
    if (dark) paths.push(`M${x + quiet} ${y + quiet}h1v1h-1z`)
  }))
  const side = SIZE + quiet * 2
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges"><path fill="#fff" d="M0 0h${side}v${side}H0z"/><path fill="#000" d="${paths.join('')}"/></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
