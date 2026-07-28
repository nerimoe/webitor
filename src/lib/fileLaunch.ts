type FileLaunchConsumer = (handles: readonly FileSystemFileHandle[]) => void

const pendingLaunches: Array<readonly FileSystemFileHandle[]> = []
let consumer: FileLaunchConsumer | null = null

window.launchQueue?.setConsumer((params) => {
  if (!params.files.length) return
  if (consumer) consumer(params.files)
  else pendingLaunches.push(params.files)
})

export function subscribeToFileLaunch(nextConsumer: FileLaunchConsumer) {
  if (consumer) throw new Error('A system file launch consumer is already registered')
  consumer = nextConsumer
  for (const handles of pendingLaunches.splice(0)) nextConsumer(handles)
  return () => {
    if (consumer === nextConsumer) consumer = null
  }
}
