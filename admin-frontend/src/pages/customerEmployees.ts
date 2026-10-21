export function employeeOptions(users: string[], names: Record<string, string>) {
  const labelFor = (id: string) => Object.hasOwn(names, id) && names[id]?.trim() ? names[id].trim() : id;
  const counts = new Map<string, number>();
  for (const id of users) counts.set(labelFor(id), (counts.get(labelFor(id)) || 0) + 1);
  return users.map(id => {
    const name = labelFor(id);
    return { value: id, label: (counts.get(name) || 0) > 1 ? `${name}（${id}）` : name, title: `${name}（${id}）`, searchText: `${name} ${id}` };
  });
}
