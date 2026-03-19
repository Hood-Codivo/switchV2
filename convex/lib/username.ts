export type UsernameValidationResult =
  | { valid: true }
  | { valid: false; error: string }

const USERNAME_REGEX = /^[a-z0-9_-]+$/
const MIN_LENGTH = 3
const MAX_LENGTH = 30

export function validateUsername(username: string): UsernameValidationResult {
  if (username.length === 0) {
    return { valid: false, error: "Username cannot be empty" }
  }
  if (username.length < MIN_LENGTH) {
    return { valid: false, error: `Username must be at least ${MIN_LENGTH} characters` }
  }
  if (username.length > MAX_LENGTH) {
    return { valid: false, error: `Username must be at most ${MAX_LENGTH} characters` }
  }
  if (!USERNAME_REGEX.test(username)) {
    return {
      valid: false,
      error: "Username can only contain lowercase letters, numbers, hyphens, and underscores",
    }
  }
  return { valid: true }
}
