import { useEffect } from 'preact/hooks';
import { useRoute } from './route';
import { Home } from './screens/Home';
import { Editor } from './screens/Editor';
import { Toasts } from './components/Toasts';

export function App() {
  const route = useRoute();
  useEffect(() => {
    document.title = route.name === 'home' ? 'Posts · Blog Editor' : 'Editing · Blog Editor';
  }, [route]);
  return (
    <>
      {route.name === 'home' ? <Home key="home" /> : <Editor key={route.file} file={route.file} />}
      <Toasts />
    </>
  );
}
