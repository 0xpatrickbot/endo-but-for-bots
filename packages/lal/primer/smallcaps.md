# SmallCaps Encoding (background)

You will rarely need to think about SmallCaps directly. The
pi-agent-core harness decodes incoming tool arguments through a
SmallCaps marshal before dispatching to the tool, and encodes results
on the way back, so plain JSON values in your tool calls behave the way
you expect.

The one place SmallCaps still surfaces in your tool calls is **message
numbers**, which are BigInts and so cannot be expressed in plain JSON.
Use the `"+N"` form for these:

```
dismiss("+5")
reply("+3", ["text"], [], [])
```

The individual tool summaries call this out for the arguments that
expect a message number. You do not need to apply SmallCaps escaping to
any other arguments; the harness handles regular strings, including
ones that start with `!`, `#`, `$`, `%`, `&`, `+`, or `-`, without any
prefix from you.

For curiosity, the full SmallCaps grammar (BigInt `"+N"`/`"-N"`,
`"#undefined"`, `"#Infinity"`, `"#-Infinity"`, `"#NaN"`, and the `!`
escape for strings that would otherwise collide with those forms) is
documented in `@endo/marshal`. You do not need it for day-to-day
operation.
