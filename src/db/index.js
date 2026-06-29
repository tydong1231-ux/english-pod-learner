import Dexie from 'dexie';

export const db = new Dexie('EnglishPodLearnerDB');

db.version(1).stores({
  podcasts: '++id, title, status, createdAt', // status: 'PENDING', 'PROCESSING', 'READY', 'ERROR'
  transcripts: 'podcastId', // podcastId is unique index. content stored as object.
  vocabulary: '++id, word, sourcePodcastId, createdAt'
});

db.version(2).stores({
  podcasts: '++id, title, status, createdAt',
  transcripts: 'podcastId',
  vocabulary: '++id, word, sourcePodcastId, createdAt',
  audioCache: 'podcastId, sourceUrl, createdAt'
});

export const PodcastStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  READY: 'READY',
  ERROR: 'ERROR'
};
