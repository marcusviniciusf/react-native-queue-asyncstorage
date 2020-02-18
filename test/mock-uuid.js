jest.mock("react-native-uuid", () => ({
  v4: () => {
    let value = 0
    return () => value++
  },
}))
