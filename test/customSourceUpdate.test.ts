import assert from 'node:assert/strict'
import test from 'node:test'
import { isCustomSourceUpdateAvailable } from '../src/server/customSourceUpdate'

test('ignores generated ISO timestamps in script comments', () => {
    const current = '/*\n * Generated at 2026-10-07T10:12:30.001Z\n */\nconst version = 1;\n'
    const remote = '/*\n * Generated at 2026-10-07T10:12:30.987Z\n */\nconst version = 1;\n'

    assert.equal(isCustomSourceUpdateAvailable(current, remote, 'v1.0.0', 'v1.0.0'), false)
})

test('still detects source code and metadata version changes', () => {
    const current = '// Generated at 2026-10-07T10:12:30.001Z\nconst quality = 1;\n'
    const timestampOnly = '// Generated at 2026-10-07T10:12:30.987Z\nconst quality = 1;\n'
    const codeChanged = '// Generated at 2026-10-07T10:12:30.987Z\nconst quality = 2;\n'

    assert.equal(isCustomSourceUpdateAvailable(current, timestampOnly, 'v1.0.0', 'v1.0.0'), false)
    assert.equal(isCustomSourceUpdateAvailable(current, codeChanged, 'v1.0.0', 'v1.0.0'), true)
    assert.equal(isCustomSourceUpdateAvailable(current, timestampOnly, 'v1.0.0', 'v1.0.1'), true)
})

test('does not normalize timestamps in executable code', () => {
    const current = 'const build = "2026-10-07T10:12:30.001Z";\n'
    const remote = 'const build = "2026-10-07T10:12:30.987Z";\n'

    assert.equal(isCustomSourceUpdateAvailable(current, remote, 'v1.0.0', 'v1.0.0'), true)
})
