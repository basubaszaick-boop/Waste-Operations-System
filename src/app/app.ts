import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/** Root component: it only hosts the router. Each page is its own component. */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.html'
})
export class App {}
