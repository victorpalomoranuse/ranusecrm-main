import { Navbar } from '../components/Navbar';
import { Landing } from '../components/Landing';
import { Footer } from '../components/Footer';

export function Home() {
  return (
    <div className="app">
      <Navbar />
      <Landing />
      <Footer />
    </div>
  );
}
