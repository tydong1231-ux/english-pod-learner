import Dexie from 'dexie';

export const db = new Dexie('EnglishPodLearnerDB');

db.version(1).stores({
  podcasts: '++id, title, status, createdAt', // status: 'PENDING', 'PROCESSING', 'READY', 'ERROR'
  transcripts: 'podcastId', // podcastId is unique index. content stored as object.
  vocabulary: '++id, word, sourcePodcastId, createdAt'
});

export const PodcastStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  READY: 'READY',
  ERROR: 'ERROR'
};
