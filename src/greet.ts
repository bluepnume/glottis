export type GreetOptions = {
    readonly name : string,
    // Punctuation after the name; defaults to an exclamation mark.
    readonly punctuation ?: string,
};

export const greet = ({ name, punctuation = '!' } : GreetOptions) : string => `Hello, ${ name }${ punctuation }`;
