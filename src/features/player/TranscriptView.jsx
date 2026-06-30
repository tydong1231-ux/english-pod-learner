import React, { useEffect, useRef, memo } from 'react';
import { Play } from 'lucide-react';
import styles from './TranscriptView.module.css';

const SegmentRow = memo(({ segment, isActive, currentTime, onSeek, onPlaySegment, onWordClick, activeRef }) => {
    return (
        <div
            className={`${styles.segment} ${isActive ? styles.activeSegment : ''}`}
            ref={isActive ? activeRef : null}
        >
            <div className={styles.segmentHeader}>
                <div className={styles.time}>{formatTime(segment.start)}</div>
                <button
                    type="button"
                    className={styles.playSegmentButton}
                    onClick={(e) => {
                        e.stopPropagation();
                        if (onPlaySegment) {
                            onPlaySegment(segment.start || 0);
                        } else {
                            onSeek(segment.start || 0);
                        }
                    }}
                    title="Play from this sentence"
                >
                    <Play size={13} fill="currentColor" />
                </button>
                {segment.speaker && (
                    <div className={styles.speaker}>{segment.speaker}</div>
                )}
            </div>
            <p className={styles.text}>
                {segment.words ? (
                    segment.words.map((wordObj, wIdx) => {
                        const wStart = wordObj.start ?? segment.start ?? 0;
                        const wEnd = wordObj.end ?? segment.end ?? 0;

                        // Only evaluate word-level active state if the segment itself is active
                        const isWordActive = isActive && currentTime !== null && (currentTime >= wStart && currentTime <= wEnd);

                        return (
                            <span
                                key={wIdx}
                                className={`${styles.word} ${isWordActive ? styles.activeWord : ''}`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onWordClick(wordObj, segment.text);
                                }}
                                title="Click to learn"
                            >
                                {typeof wordObj === 'string' ? wordObj : wordObj.word}{' '}
                            </span>
                        );
                    })
                ) : (
                    <span onClick={() => onSeek(segment.start)}>{segment.text}</span>
                )}
            </p>
        </div>
    );
});

export function TranscriptView({ transcript, currentTime, onSeek, onPlaySegment, onWordClick }) {
    const activeRef = useRef(null);
    const containerRef = useRef(null);

    const activeSegmentIndex = transcript?.segments?.findIndex((segment) =>
        currentTime >= (segment.start || 0) && currentTime <= (segment.end || 99999)
    ) ?? -1;

    useEffect(() => {
        if (activeSegmentIndex >= 0 && activeRef.current && containerRef.current) {
            activeRef.current.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
            });
        }
    }, [activeSegmentIndex]);

    if (!transcript || !transcript.segments) return <div className={styles.empty}>No transcript available.</div>;

    return (
        <div className={styles.container} ref={containerRef}>
            {transcript.segments.map((segment, sIdx) => {
                const isActive = sIdx === activeSegmentIndex;

                return (
                    <SegmentRow
                        key={sIdx}
                        segment={segment}
                        isActive={isActive}
                        currentTime={isActive ? currentTime : null}
                        onSeek={onSeek}
                        onPlaySegment={onPlaySegment}
                        onWordClick={onWordClick}
                        activeRef={activeRef}
                    />
                );
            })}
        </div>
    );
}

function formatTime(seconds) {
    if (!seconds) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}
