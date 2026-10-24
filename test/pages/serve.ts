// A page that serves one scenario, named in its query string.
import { reportCoverage } from '../coverage';
import { runScenario } from '../scenarios';

reportCoverage();

const params = new URLSearchParams(location.search);

runScenario({ name: params.get('scenario') ?? 'basic', parent: params.get('parent') ?? '' });
