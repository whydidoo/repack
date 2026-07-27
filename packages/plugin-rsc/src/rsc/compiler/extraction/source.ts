import { analyzeRscModule } from '../parseRscModule.js';
import type { RscPruningAnalysis, RscSourceRange } from '../parseRscModule.js';

export interface SourceEdit {
  readonly end: number;
  readonly replacement: string;
  readonly start: number;
}

export function applySourceEdits(
  source: string,
  edits: readonly SourceEdit[]
): string {
  let result = source;
  for (const edit of [...edits].sort(
    (left, right) => right.start - left.start
  )) {
    const removedLineBreaks = countLineBreaks(
      result.slice(edit.start, edit.end)
    );
    const replacementLineBreaks = countLineBreaks(edit.replacement);
    const linePadding = Math.max(0, removedLineBreaks - replacementLineBreaks);
    const preserveTrailingSemicolon =
      linePadding > 0 && result.at(edit.end) === ';';
    result =
      result.slice(0, edit.start) +
      edit.replacement +
      (preserveTrailingSemicolon ? ';' : '') +
      '\n'.repeat(linePadding) +
      result.slice(edit.end + (preserveTrailingSemicolon ? 1 : 0));
  }
  return result;
}

function countLineBreaks(value: string): number {
  return value.match(/\n/g)?.length ?? 0;
}

export function pruneUnreachableModuleCode(
  code: string,
  filename: string,
  options: {
    readonly originalAnalysis: RscPruningAnalysis;
    readonly preservedBindings?: ReadonlySet<string>;
    readonly replacedRanges: readonly RscSourceRange[];
  }
): string {
  const preservedBindings = options.preservedBindings ?? new Set<string>();
  const eligibleBindings = collectPrunableBindings(
    options.originalAnalysis,
    options.replacedRanges
  );
  if (eligibleBindings.size === 0) {
    return code;
  }

  // Re-analyze the edited source once, then solve transitive reachability over
  // the resulting binding graph. This replaces the former parse/delete loop.
  const analysis = analyzeRscModule(code, filename).pruning;
  const candidatesByName = new Map(
    analysis.candidates.flatMap((candidate) =>
      candidate.names.map((name) => [name, candidate] as const)
    )
  );
  const isRemovableCandidate = (
    candidate: (typeof analysis.candidates)[number]
  ) =>
    candidate.names.every(
      (name) => eligibleBindings.has(name) && !preservedBindings.has(name)
    );

  const liveReferences = new Set(analysis.externalReferences);
  const pending = [...analysis.externalReferences];
  for (const candidate of analysis.candidates) {
    if (!isRemovableCandidate(candidate)) {
      for (const reference of candidate.references) {
        if (!liveReferences.has(reference)) {
          liveReferences.add(reference);
          pending.push(reference);
        }
      }
    }
  }

  const retainedCandidates = new Set<(typeof analysis.candidates)[number]>();
  while (pending.length > 0) {
    const name = pending.shift();
    if (!name) {
      continue;
    }
    const candidate = candidatesByName.get(name);
    if (
      !candidate ||
      !isRemovableCandidate(candidate) ||
      retainedCandidates.has(candidate)
    ) {
      continue;
    }
    retainedCandidates.add(candidate);
    for (const reference of candidate.references) {
      if (!liveReferences.has(reference)) {
        liveReferences.add(reference);
        pending.push(reference);
      }
    }
  }

  const removedCandidates = new Set(
    analysis.candidates.filter(
      (candidate) =>
        isRemovableCandidate(candidate) && !retainedCandidates.has(candidate)
    )
  );
  const declarationEdits: SourceEdit[] = [];
  const handledDeclarations = new Set<string>();
  for (const candidate of removedCandidates) {
    if (!candidate.declaration) {
      declarationEdits.push({
        end: candidate.end,
        replacement: '',
        start: candidate.start,
      });
      continue;
    }

    const declaration = candidate.declaration;
    const declarationKey = `${declaration.start}:${declaration.end}`;
    if (handledDeclarations.has(declarationKey)) {
      continue;
    }
    handledDeclarations.add(declarationKey);
    const declarationCandidates = analysis.candidates
      .filter(
        (entry) =>
          entry.declaration?.start === declaration.start &&
          entry.declaration?.end === declaration.end
      )
      .sort((left, right) => left.start - right.start);
    const retainedDeclarators = declarationCandidates.filter(
      (entry) => !removedCandidates.has(entry)
    );
    const replacement =
      retainedDeclarators.length === 0
        ? ''
        : code.slice(declaration.start, declarationCandidates[0].start) +
          retainedDeclarators
            .map((entry) => code.slice(entry.start, entry.end))
            .join(', ') +
          code.slice(
            declarationCandidates.at(-1)?.end ?? declaration.end,
            declaration.end
          );
    declarationEdits.push({
      end: declaration.end,
      replacement,
      start: declaration.start,
    });
  }
  const importEdits = analysis.imports
    .filter(
      (entry) =>
        entry.bindings.some((binding) => eligibleBindings.has(binding)) &&
        entry.bindings.every((binding) => !liveReferences.has(binding))
    )
    .map((entry) => ({
      end: entry.end,
      replacement: '',
      start: entry.start,
    }));
  return applySourceEdits(code, [...declarationEdits, ...importEdits]);
}

function collectPrunableBindings(
  analysis: RscPruningAnalysis,
  replacedRanges: readonly RscSourceRange[]
): ReadonlySet<string> {
  const candidatesByName = new Map(
    analysis.candidates.flatMap((candidate) =>
      candidate.names.map((name) => [name, candidate] as const)
    )
  );
  const eligible = new Set<string>();
  const pending = analysis.referenceLocations
    .filter((reference) =>
      replacedRanges.some(
        (range) => reference.start >= range.start && reference.start < range.end
      )
    )
    .map((reference) => reference.name);

  while (pending.length > 0) {
    const name = pending.shift();
    if (!name || eligible.has(name)) {
      continue;
    }
    eligible.add(name);
    for (const reference of candidatesByName.get(name)?.references ?? []) {
      if (!eligible.has(reference)) {
        pending.push(reference);
      }
    }
  }
  return eligible;
}

export function chooseGeneratedBinding(
  source: string,
  preferred: string
): string {
  let binding = preferred;
  let suffix = 0;
  while (source.includes(binding)) {
    suffix += 1;
    binding = `${preferred}_${suffix}`;
  }
  return binding;
}
