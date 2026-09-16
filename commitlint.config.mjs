/**
 * Conventional Commits, with Chinese subjects allowed.
 *
 * The repo's history mixes conventional prefixes with plain Chinese subjects, so
 * this config starts permissive on subject content and only enforces the
 * structure that tooling (changelogs, semver bumps) actually parses.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Chinese subjects have no case, and the repo uses lowercase English ones.
    'subject-case': [0],
    // Allow longer subjects for Chinese text, which is denser per character.
    'header-max-length': [2, 'always', 100],
    // Conventional types plus the ones already used in this repo.
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'],
    ],
  },
}
