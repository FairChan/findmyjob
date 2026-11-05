import 'server-only'

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus: number = 400,
  ) {
    super(message)
    this.name = this.constructor.name
    // Maintain proper prototype chain in compiled JS
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(message, 'NOT_FOUND', 404)
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 'FORBIDDEN', 403)
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed') {
    super(message, 'VALIDATION_ERROR', 422)
  }
}

export class InsufficientCreditsError extends AppError {
  constructor(message = 'Insufficient credits') {
    super(message, 'INSUFFICIENT_CREDITS', 402)
  }
}

export class RateLimitedError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 'RATE_LIMITED', 429)
  }
}

export class FeatureDisabledError extends AppError {
  constructor(message = 'Feature is disabled') {
    super(message, 'FEATURE_DISABLED', 403)
  }
}

export class DecryptError extends AppError {
  constructor(message = 'Decryption failed') {
    super(message, 'DECRYPT_ERROR', 500)
  }
}

export class SignupClosedError extends AppError {
  constructor(message = 'Student registration is currently full') {
    super(message, 'SIGNUP_CLOSED', 403)
  }
}
