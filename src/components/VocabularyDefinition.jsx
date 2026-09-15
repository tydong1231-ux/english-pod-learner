import styles from './VocabularyDefinition.module.css';

// Keep the existing stored meaning format, while presenting roots separately.
export function VocabularyDefinition({ text = '', className }) {
    const value = typeof text === 'string' ? text : '';
    const marker = '【词根拆解】';
    const boundary = value.indexOf(marker);
    const definition = boundary < 0 ? value : value.slice(0, boundary).trim();
    const roots = boundary < 0 ? [] : value.slice(boundary + marker.length)
        .split(/[①②]/u).map((part) => part.trim()).filter(Boolean).slice(0, 2);

    return (
        <>
            <div className={className}>{definition}</div>
            {roots.length > 0 && (
                <section className={styles.roots} aria-label="词根拆解">
                    <h4 className={styles.heading}>词根拆解</h4>
                    {roots.map((root, index) => {
                        const separator = root.search(/[:：]/u);
                        const title = separator < 0 ? root : root.slice(0, separator);
                        const examples = separator < 0 ? [] : root.slice(separator + 1)
                            .split(/[;；]/u).map((example) => example.trim()).filter(Boolean).slice(0, 2);
                        return (
                            <div className={styles.root} key={index}>
                                <div className={styles.rootTitle}>
                                    <span className={styles.number}>{index + 1}</span>
                                    <strong>{title}</strong>
                                </div>
                                {examples.length > 0 && (
                                    <ul className={styles.examples}>
                                        {examples.map((example, i) => <li key={i}>{example}</li>)}
                                    </ul>
                                )}
                            </div>
                        );
                    })}
                </section>
            )}
        </>
    );
}
