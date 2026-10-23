// 1,000 trials of a full cursor-paginated walk over a feed being concurrently
// mutated (new posts inserted at the head between page fetches), tallying total
// duplicated and skipped items across all trials. Also runs the same mutation
// pattern through the naive offset paginator, for contrast (see README).
import { MutableFeed, cursorWalk, offsetWalk } from '../src/pagination.js';

async function runTrials(mode: 'cursor' | 'offset', trials: number) {
  let totalDuplicates = 0;
  let totalSkipped = 0;
  for (let t = 0; t < trials; t++) {
    const feed = new MutableFeed(50);
    const pageSize = 5;
    const mutations = (t % 7) + 1; // vary mutation pressure across trials, 1..7
    const walk = mode === 'cursor' ? cursorWalk : offsetWalk;
    const result = await walk(feed, pageSize, mutations);
    totalDuplicates += result.duplicates;
    totalSkipped += result.skipped;
  }
  return { totalDuplicates, totalSkipped };
}

async function main() {
  const trials = Number(process.argv[2] ?? 1000);

  const cursorResult = await runTrials('cursor', trials);
  console.log('---RESULTS---');
  console.log(`mode=cursor trials=${trials} duplicates=${cursorResult.totalDuplicates} skipped=${cursorResult.totalSkipped}`);

  const offsetResult = await runTrials('offset', trials);
  console.log(`mode=offset trials=${trials} duplicates=${offsetResult.totalDuplicates} skipped=${offsetResult.totalSkipped}`);
}

main();
