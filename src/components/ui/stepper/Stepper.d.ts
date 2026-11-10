import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode } from 'react'

export interface StepProps {
  children?: ReactNode
  /** Label shown under the indicator, or beside it in the vertical layout. */
  title?: ReactNode
  /** Second line shown beside the indicator in the vertical layout. */
  description?: ReactNode
  /** Icon shown inside the indicator instead of the number. */
  icon?: ReactNode
}

export interface StepperProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children: ReactNode
  /** Controls the current step yourself. Use it with onStepChange. */
  step?: number
  initialStep?: number
  onStepChange?: (step: number) => void
  onFinalStepCompleted?: () => void
  indicator?: 'numbers' | 'dots' | 'bars'
  orientation?: 'horizontal' | 'vertical'
  transition?: 'slide' | 'fade' | 'none'
  /** Only lets the indicators jump back to steps that have been reached. */
  linear?: boolean
  /** Stops the indicators from changing the step when clicked. */
  disableStepIndicators?: boolean
  renderStepIndicator?: (args: { step: number; currentStep: number; onStepClick: (step: number) => void }) => ReactNode
  showFooter?: boolean
  backButtonText?: string
  nextButtonText?: string
  completeButtonText?: string
  backButtonProps?: ButtonHTMLAttributes<HTMLButtonElement>
  nextButtonProps?: ButtonHTMLAttributes<HTMLButtonElement>
  completedContent?: ReactNode
  theme?: 'dark' | 'light'
  accentColor?: string
  frame?: boolean
  radius?: number
  width?: number | string
  stepContainerClassName?: string
  contentClassName?: string
  footerClassName?: string
  style?: CSSProperties
}

export function Step(props: StepProps): ReactNode
export default function Stepper(props: StepperProps): ReactNode
