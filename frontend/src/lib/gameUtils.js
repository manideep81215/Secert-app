export const PIN_CODE = '2468'

export const winsAgainst = {
  rock: 'scissors',
  paper: 'rock',
  scissors: 'paper',
}

export function randomPick(list) {
  return list[Math.floor(Math.random() * list.length)]
}

export function getTttWinner(board) {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ]

  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[b] === board[c]) {
      return board[a]
    }
  }

  if (board.every(Boolean)) return 'draw'
  return ''
}
