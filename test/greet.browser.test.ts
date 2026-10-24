import { greet } from '../src';

// Runs in headless Chromium through vitest's browser project; the DOM is real.
describe('greet in a browser', () => {
    it('renders into the document', () => {
        const el = document.createElement('p');

        el.textContent = greet({ name: 'Browser' });
        document.body.append(el);

        expect(document.body.textContent).toContain('Hello, Browser!');
    });
});
