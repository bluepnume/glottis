// tool(): a function with a description and schemas. It returns a function
// that validates its first argument against `input` before calling the
// handler, and records the metadata the manifest reads. Functions made with
// tool() are also the ones a page offers to AI agents over WebMCP.

import { ref } from 'sandestin';

import type { InferOutput, JsonSchema, Schema } from './schema';

import { toJsonSchema, validate } from './schema';

// Hints for agents, passed to WebMCP as they are. WebMCP knows the three
// below today; any other hint passes through too.
export type ToolAnnotations = {
    // The tool only reads, with no side effects.
    readonly readOnlyHint ?: boolean,
    // The tool does something significant or irreversible; agents may ask
    // the user first.
    readonly consequentialHint ?: boolean,
    // The result holds outside content, to treat as data, not instructions.
    readonly untrustedContentHint ?: boolean,
    readonly [hint : string] : unknown,
};

export type FunctionMetadata = {
    readonly name ?: string,
    readonly description ?: string,
    readonly input ?: JsonSchema,
    readonly output ?: JsonSchema,
    readonly annotations ?: ToolAnnotations,
    readonly once ?: boolean,
};

const metadata = new WeakMap<object, FunctionMetadata>();

// Tools given an `input` schema, whether or not it converted to JSON Schema.
const withInput = new WeakSet();

export const getFunctionMetadata = (fn : object) : FunctionMetadata | undefined => metadata.get(fn);

export const isTool = (fn : object) : boolean => metadata.has(fn);

export const hasInputSchema = (fn : object) : boolean => withInput.has(fn);

type AnyHandler = (...args : ReadonlyArray<never>) => unknown;

type Described<Input, Handler> = Handler extends (first : infer First, ...rest : infer Rest) => infer Result
    ? (
        first : Input extends undefined ? First : InferOutputInput<Input, First>,
        ...rest : Rest
    ) => Promise<Awaited<Result>>
    : never;

type InferOutputInput<Input, First> = unknown extends InferOutput<Input>
    ? First
    : InferOutput<Input>;

type ToolOptions<Input extends Schema | undefined, Handler> = {
    // The function itself. With an `input` validator, its first argument is
    // the validated (and defaulted) value.
    readonly handler : Handler,
    readonly description ?: string,
    readonly input ?: Input,
    readonly output ?: Schema,
    // JSON Schema for the manifest, for validators that cannot produce it.
    readonly jsonSchema ?: {
        readonly input ?: JsonSchema,
        readonly output ?: JsonSchema,
    },
    // The WebMCP tool name, in place of the one built from its path.
    readonly name ?: string,
    readonly annotations ?: ToolAnnotations,
    // Released after its first call; a second call rejects.
    readonly once ?: boolean,
};

export const tool = <Handler extends AnyHandler, Input extends Schema | undefined = undefined>({
    handler, description, input, output, jsonSchema, name, annotations, once = false
} : ToolOptions<Input, Handler>) : Described<Input, Handler> => {
    // Named after the handler when it has a name of its own.
    const handlerName = handler.name && handler.name !== 'handler'
        ? handler.name
        : undefined;

    const described = async (first : unknown, ...rest : ReadonlyArray<unknown>) : Promise<unknown> => {
        const value = await validate({
            schema:  input,
            value:   first,
            subject: handlerName
                ? `input for ${ handlerName }`
                : 'input'
        });

        return (handler as unknown as (...args : ReadonlyArray<unknown>) => unknown)(value, ...rest);
    };

    Object.defineProperty(described, 'name', { value: handlerName ?? '' });

    const inputSchema = toJsonSchema({ schema: input, explicit: jsonSchema?.input });
    const outputSchema = toJsonSchema({ schema: output, explicit: jsonSchema?.output });

    metadata.set(described, {
        ...name === undefined
            ? {}
            : { name },
        ...description === undefined
            ? {}
            : { description },
        ...inputSchema
            ? { input: inputSchema }
            : {},
        ...outputSchema
            ? { output: outputSchema }
            : {},
        ...annotations === undefined
            ? {}
            : { annotations },
        ...once
            ? { once }
            : {}
    });

    if (input !== undefined || jsonSchema?.input !== undefined) {
        withInput.add(described);
    }

    if (once) {
        ref({ fn: described, once: true });
    }

    return described as unknown as Described<Input, Handler>;
};

// The name tool() had before 0.3.
// @deprecated Use tool(); describe.function goes in the next release.
export const describe = {
    function: tool
};
