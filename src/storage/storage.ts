import AsyncStorage from '@react-native-async-storage/async-storage'

interface DeviceStorage {
  get<T>(key: string): Promise<T[] | null>
  save(key: string | [string, any][], value?: any): Promise<void>
  delete(key: string | string[]): Promise<void>
  push<T>(key: string, value: T): Promise<void>
}

const deviceStorage: DeviceStorage = {
  /**
   * Get a one or more value for a key or array of keys from AsyncStorage
   * @param {string} key A key or array of keys
   * @return {promise}
   */
  get: async <T>(key: string) => {
    const value = await AsyncStorage.getItem(key)
    return value ? (JSON.parse(value) as T[]) : null
  },

  /**
   * Save a key value pair or a series of key value pairs to AsyncStorage.
   * @param {string|array} key The key or an array of key/value pairs
   * @param {any} value The value to save
   * @return {promise}
   */
  save: async (key, value) => {
    if (!Array.isArray(key)) {
      await AsyncStorage.setItem(key, JSON.stringify(value))
    } else {
      const pairs: [string, string][] = key.map(([k, v]) => [k, JSON.stringify(v)])
      await AsyncStorage.multiSet(pairs)
    }
  },

  /**
   * Delete the value for a given key in AsyncStorage.
   * @param {string|array} key The key or an array of keys to be deleted
   * @return {promise}
   */
  async delete(key: string | string[]) {
    if (Array.isArray(key)) {
      await AsyncStorage.multiRemove(key)
    } else {
      await AsyncStorage.removeItem(key)
    }
  },

  /**
   * Push a value onto an array stored in AsyncStorage by key or create a new array in AsyncStorage for a key if it's not yet defined.
   * @param {string} key They key
   * @param {any} value The value to push onto the array
   * @return {promise}
   */
  push: async <T>(key: string, value: T) => {
    try {
      const currentValue = await deviceStorage.get<T[]>(key)
      if (currentValue === null) {
        // if there is no current value, populate it with the new value
        await deviceStorage.save(key, [value])
      } else if (Array.isArray(currentValue)) {
        await deviceStorage.save(key, [...currentValue, value])
      } else {
        throw new Error(
          `Existing value for key "${key}" must be of type null or Array, received ${typeof currentValue}.`,
        )
      }
    } catch (error) {
      console.error('Error in deviceStorage.push:', error)
      throw error
    }
  },
}

export default deviceStorage
