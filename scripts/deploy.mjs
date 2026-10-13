// Builds the game and publishes dist/ to the gh-pages branch (GitHub Pages source).
// Run: npm run deploy   (tests and build must pass first)
import { execSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';

const sh = (cmd, cwd) => execSync(cmd, { stdio: 'inherit', cwd });
const remote = execSync('git remote get-url origin').toString().trim();
const rev = execSync('git rev-parse --short HEAD').toString().trim();

sh('npm test');
sh('npm run build');
writeFileSync('dist/.nojekyll', '');
rmSync('dist/.git', { recursive: true, force: true });
sh('git init -q -b gh-pages', 'dist');
sh('git add -A', 'dist');
sh(`git -c user.name=deploy -c user.email=deploy@localhost commit -q -m "Deploy ${rev}"`, 'dist');
sh(`git push -f -q ${remote} gh-pages`, 'dist');
rmSync('dist/.git', { recursive: true, force: true });
console.log(`Deployed ${rev} to gh-pages`);
