import type { VibeStyle } from '../../types'
import type { Scene } from './engine'
import { office } from './office'
import { arcade } from './arcade'

export const SCENES: Record<VibeStyle, Scene> = { office, arcade }
