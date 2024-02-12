type PromiseResult<T> = {data?: T; error?: any; status: 'resolved' | 'rejected'}

async function handlePromise<T>(promise: Promise<T>): Promise<PromiseResult<T>> {
  try {
    const data = await promise
    return {data, status: 'resolved'}
  } catch (error) {
    return {error, status: 'rejected'}
  }
}

export default handlePromise
