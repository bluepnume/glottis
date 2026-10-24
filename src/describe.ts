// describe.function: a function with a description and schemas. It returns a
// function that validates its first argument against `input` before calling
// the handler, and records the metadata the manifest reads.

import { ref } from 'sandestin';

import type { InferOutput, JsonSchema, Schema } from './schema';

import { toJsonSchema, validate } from './schema';

export type FunctionMetadata = {
    readonly description ?: string,
    readonly input ?: JsonSchema,
    readonly output ?: JsonSchema,
    readonly once ?: boolean,
};

const metadata = new WeakMap<object, FunctionMetadata>();

export const getFunctionMetadata = (fn : object) : FunctionMetadata | undefined => metadata.get(fn);

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

type DescribeFunctionOptions<Input extends Schema | undefined, Handler> = {
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
    // Released after its first call; a second call rejects.
    readonly once ?: boolean,
};

const describeFunction = <Handler extends AnyHandler, Input extends Schema | undefined = undefined>({
    handler, description, input, output, jsonSchema, once = false
} : DescribeFunctionOptions<Input, Handler>) : Described<Input, Handler> => {
    // Named after the handler when it has a name of its own.
    const name = handler.name && handler.name !== 'handler'
        ? handler.name
        : undefined;

    const described = async (first : unknown, ...rest : ReadonlyArray<unknown>) : Promise<unknown> => {
        const value = await validate({
            schema:  input,
            value:   first,
            subject: name
                ? `input for ${ name }`
                : 'input'
        });

        return (handler as unknown as (...args : ReadonlyArray<unknown>) => unknown)(value, ...rest);
    };

    Object.defineProperty(described, 'name', { value: name ?? '' });

    const recorded : FunctionMetadata = {
        ...description === undefined
            ? {}
            : { description },
        ...once
            ? { once }
            : {}
    };

    const inputSchema = toJsonSchema({ schema: input, explicit: jsonSchema?.input });
    const outputSchema = toJsonSchema({ schema: output, explicit: jsonSchema?.output });

    metadata.set(described, {
        ...recorded,
        ...inputSchema
            ? { input: inputSchema }
            : {},
        ...outputSchema
            ? { output: outputSchema }
            : {}
    });

    if (once) {
        ref({ fn: described, once: true });
    }

    return described as unknown as Described<Input, Handler>;
};

export const describe = {
    function: describeFunction
};
