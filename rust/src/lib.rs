// Server der Handelsinseln in Rust – Portierung von server/*.js.
// „S“ als Feldname des Spielzustands ist bewusst an die JS-Vorlage angelehnt.
#![allow(non_snake_case)]
pub mod arm;
pub mod avatars;
pub mod board;
pub mod game;
pub mod game_actions;
pub mod game_awards;
pub mod game_build;
pub mod game_lobby;
pub mod game_trade;
pub mod bot;
pub mod bots;
pub mod botplay;
pub mod hub;
pub mod http;
pub mod log;
pub mod server;
pub mod geom;
pub mod model;
pub mod pair;
pub mod rng;
pub mod rules;
pub mod settings;
pub mod table_offer;
pub mod tls;
pub mod view;
