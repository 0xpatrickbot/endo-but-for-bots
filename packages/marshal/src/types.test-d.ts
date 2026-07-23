// eslint-disable-next-line import/no-extraneous-dependencies
import { expectTypeOf } from 'expect-type';

import { Far, type AtomStyle, type RemotableObject } from '@endo/pass-style';
import { makeMarshal } from './marshal.js';

expectTypeOf('string' as const).toExtend<AtomStyle>();
expectTypeOf('number' as const).toExtend<AtomStyle>();
// @ts-expect-error
expectTypeOf(1).toEqualTypeOf<AtomStyle>();
// @ts-expect-error
expectTypeOf('str').toEqualTypeOf<AtomStyle>();

type KCap = RemotableObject & { getKref: () => string; iface: () => string };
const valToSlot = (s: KCap) => s.getKref();
const slotToVal = (s: string) => null as unknown as KCap;
const marshal = makeMarshal(valToSlot, slotToVal);
const cycled = marshal.fromCapData(marshal.toCapData(null as unknown as KCap));
expectTypeOf(cycled).toEqualTypeOf<unknown>();

const m = makeMarshal();
const foo1 = Far('foo', { getBoardId: () => 'board1' });
const foo2 = Far('foo', { getBoardId: () => 'board2' });
const bar1 = Far('bar', { getBoardId: () => 'board1' });
m.toCapData(harden({ o: foo1 }));
m.toCapData(harden({ o: foo2 }));
m.toCapData(harden({ o: bar1 }));
