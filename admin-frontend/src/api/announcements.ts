import client from './client';

export interface Announcement {
  id: number;
  title: string;
  content: string;
  tag: string;
  date: string;
  createdAt: string;
  updatedAt: string;
}

export async function getAnnouncements(): Promise<Announcement[]> {
  const { data } = await client.get('/announcements');
  return data;
}

export async function createAnnouncement(body: {
  title: string;
  content: string;
  tag?: string;
}): Promise<Announcement> {
  const { data } = await client.post('/announcements', body);
  return data;
}

export async function updateAnnouncement(
  id: number,
  body: { title?: string; content?: string; tag?: string },
): Promise<Announcement> {
  const { data } = await client.put(`/announcements/${id}`, body);
  return data;
}

export async function deleteAnnouncement(id: number): Promise<void> {
  await client.delete(`/announcements/${id}`);
}
