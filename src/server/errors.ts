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

export class TwoFactorRequiredError extends AppError {
  constructor() {
    super('Set up two-factor authentication', 'TWO_FACTOR_REQUIRED', 403)
  }
}

export class FreshSessionRequiredError extends AppError {
  constructor() {
    super('Sign in again to continue', 'FRESH_SESSION_REQUIRED', 403)
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

export class VersionMismatchError extends AppError {
  constructor(message = 'Terms version mismatch') {
    super(message, 'VERSION_MISMATCH', 409)
  }
}

export class DuplicateApplicationError extends AppError {
  constructor(message = 'Already applied to this job') {
    super(message, 'DUPLICATE_APPLICATION', 409)
  }
}

export class CompletenessLowError extends AppError {
  constructor(message = 'Profile completeness too low to apply') {
    super(message, 'COMPLETENESS_LOW', 400)
  }
}

export class ContactRequiredError extends AppError {
  constructor() {
    super('Add at least one contact method before applying', 'CONTACT_REQUIRED', 400)
  }
}

export class ResumeRequiredError extends AppError {
  constructor() {
    super('Upload a PDF resume before applying', 'RESUME_REQUIRED', 400)
  }
}

export class InvitationQuotaError extends AppError {
  constructor(message = 'Monthly invitation quota exceeded') {
    super(message, 'INVITATION_QUOTA_EXCEEDED', 429)
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict: resource was modified by another operation') {
    super(message, 'CONFLICT', 409)
  }
}
