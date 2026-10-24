import { greet } from '../src';

describe('greet', () => {
    it('greets by name', () => {
        expect(greet({ name: 'World' })).toBe('Hello, World!');
    });

    it('accepts custom punctuation', () => {
        expect(greet({ name: 'World', punctuation: '?' })).toBe('Hello, World?');
    });
});
