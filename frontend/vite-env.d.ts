/// <reference types="vite/client" />

// Allow JSON imports for contract ABIs
declare module '*.json' {
  const value: any
  export default value
}

// MetaMask / EIP-1193 provider
interface Window {
  ethereum?: {
    request: (args: { method: string; params?: any[] }) => Promise<any>
    on: (event: string, handler: (...args: any[]) => void) => void
    removeListener: (event: string, handler: (...args: any[]) => void) => void
  }
}
