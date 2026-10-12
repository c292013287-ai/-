export function customerFields(contact: Record<string, unknown>, follow: Record<string, unknown>) {
  const strings = (value: unknown): string[] => Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string' && !!item.trim()))] : [];
  return {
    avatar: typeof contact.avatar === 'string' && /^https?:\/\//i.test(contact.avatar) ? contact.avatar : '',
    gender: contact.gender === 1 || contact.gender === 2 ? contact.gender : 0,
    remarkMobiles: strings(follow.remark_mobiles),
    tags: strings(follow.tag_id).map(id => ({ id, name: '' })),
    addWay: typeof follow.add_way === 'number' && Number.isInteger(follow.add_way) ? follow.add_way : null,
    state: typeof follow.state === 'string' ? follow.state : '',
  };
}
