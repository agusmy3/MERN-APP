// Leaflet sebagai global SEBELUM plugin (leaflet.markercluster memakai `L` global). Import modul ini, bukan 'leaflet'
// langsung, di komponen yang memakai plugin; urutan import ESM menjamin window.L sudah ada saat plugin dievaluasi.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

window.L = L;
export default L;
