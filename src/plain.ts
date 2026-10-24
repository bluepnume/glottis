// Whether a value is a plain object: a namespace in exports, or data that is
// walked rather than passed whole.

export const isPlainObject = (value : unknown) : value is Record<string, unknown> => {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const proto : unknown = Object.getPrototypeOf(value);

    return proto === Object.prototype || proto === null;
};
