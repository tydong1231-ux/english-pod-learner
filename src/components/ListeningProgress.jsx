import { listeningState } from '../lib/listeningProgress';
import './ListeningProgress.css';

export function ListeningProgress({ record, duration, title }) {
    const state = listeningState(record, duration);
    const label = state.completed ? 'Played' : state.started ? state.duration > 0 ? `${state.percent}% played` : 'In progress' : 'Unplayed';
    return <span className="listening-progress" data-state={state.completed ? 'completed' : state.started ? 'started' : 'unplayed'}>
        <progress max="100" value={state.percent} aria-label={`Listening progress for ${title}`} aria-valuetext={label} />
        <span>{state.started && !state.completed && state.duration > 0 ? `${state.percent}%` : label}</span>
    </span>;
}
