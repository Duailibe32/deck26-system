import { z } from 'zod';

// Base schemas must not import the public index: feature modules use them while
// the index is still being initialized by Node and by browser bundles.
export const IsoDateTimeSchema = z.string().datetime({ offset: true }).or(z.string().min(10));
