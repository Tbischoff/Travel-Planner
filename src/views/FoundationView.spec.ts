import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import FoundationView from './FoundationView.vue'

describe('FoundationView', () => {
  it('renders the v3 foundation status', () => {
    const wrapper = mount(FoundationView)

    expect(wrapper.text()).toContain('v3 Foundation')
    expect(wrapper.text()).toContain('Entwicklungsumgebung')
  })
})
